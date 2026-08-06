import { useCallback, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useAppMode } from "@/lib/app-mode";
import { useApp } from "@/lib/store";
import { useListening } from "@/lib/listening-store";
import { useCloudCollection } from "@/lib/cloud-hooks";
import { computeFeedbackScore, type CriterionValue, type Feedback } from "@/lib/feedback-domain";
import {
  createFeedback as createFeedbackFn,
  updateFeedback as updateFeedbackFn,
  setFeedbackPublished as setFeedbackPublishedFn,
  assignArticleToRepresentative as assignArticleFn,
  saveCoachingPlan as saveCoachingPlanFn,
  createListeningSchedule as createScheduleFn,
  updateListeningSchedule as updateScheduleFn,
  deleteListeningSchedule as deleteScheduleFn,
} from "@/lib/feedback.functions";

/**
 * The single write surface the Feedback & Listening UI uses.
 *
 * Two things it exists to guarantee:
 *
 *  1. EVERY write is awaited and can fail visibly. The previous code called
 *     `void cloud.update(...)` from onClick handlers, so a rejected promise
 *     was recorded by error-capture.ts and never surfaced — the manager saw
 *     "המשוב פורסם לנציג" whether or not the row had changed. Every function
 *     here returns a promise the caller must await, and a failure throws.
 *  2. Demo Mode and Live Mode are switched in exactly ONE place. Demo Mode
 *     keeps its in-memory store implementations; Live Mode goes through the
 *     audited server functions. Neither branch pretends to be the other: the
 *     few actions that have no Demo Mode equivalent report that honestly via
 *     `canPersist` rather than showing a success toast for nothing.
 */

export type FeedbackFormFields = {
  date: string;
  callId: string;
  callType: string;
  listener: string;
  criteria: Record<string, CriterionValue>;
  keep: string;
  improve: string;
  managerSummary: string;
  nextTask: string;
};

function toServerFields(f: FeedbackFormFields) {
  return {
    feedback_date: f.date,
    call_id: f.callId,
    call_type: f.callType,
    listener: f.listener,
    criteria: f.criteria,
    keep_doing: f.keep,
    improve: f.improve,
    manager_summary: f.managerSummary,
    next_task: f.nextTask,
  };
}

export type CoachingPlanRow = {
  id: string;
  representative_id: string;
  target_score: number;
  review_on: string;
  focus_sections: string;
  notes: string;
  review_schedule_id: string | null;
  updated_at: string;
};

/**
 * Persisted coaching plans for the representatives in scope. Read-only here —
 * writes go through useFeedbackActions().saveCoachingPlan, and coaching_plans
 * is on CLOUD_WRITE_PROTECTED_TABLES so the generic writer cannot touch it.
 */
export function useCoachingPlans(repIds: string[]) {
  const cloud = useCloudCollection<CoachingPlanRow>("coaching_plans", {
    in: repIds.length > 0 ? { representative_id: repIds } : undefined,
    enabled: repIds.length > 0,
  });
  const byRepId = useMemo(() => {
    const map = new Map<string, CoachingPlanRow>();
    for (const p of cloud.rows) map.set(p.representative_id, p);
    return map;
  }, [cloud.rows]);
  return { byRepId, isLoading: cloud.isLoading, isError: cloud.isError, live: cloud.live };
}

export function useFeedbackActions() {
  const { isDemo } = useAppMode();
  const app = useApp();
  const listening = useListening();
  const qc = useQueryClient();

  const createFeedbackSrv = useServerFn(createFeedbackFn);
  const updateFeedbackSrv = useServerFn(updateFeedbackFn);
  const setPublishedSrv = useServerFn(setFeedbackPublishedFn);
  const assignArticleSrv = useServerFn(assignArticleFn);
  const saveCoachingPlanSrv = useServerFn(saveCoachingPlanFn);
  const createScheduleSrv = useServerFn(createScheduleFn);
  const updateScheduleSrv = useServerFn(updateScheduleFn);
  const deleteScheduleSrv = useServerFn(deleteScheduleFn);

  /**
   * Awaited, not fire-and-forget: the caller must not report success until the
   * refreshed rows have actually landed, otherwise the screen still shows the
   * pre-write state under the success toast.
   */
  const refetch = useCallback(
    async (...tables: string[]) => {
      await Promise.all(tables.map((t) => qc.refetchQueries({ queryKey: ["cloud", t] })));
    },
    [qc],
  );

  const createFeedback = useCallback(
    async (input: FeedbackFormFields & { repId: string; scheduleId: string | null }) => {
      if (isDemo) {
        app.addFeedback({
          repId: input.repId,
          date: input.date,
          callId: input.callId,
          callType: input.callType,
          listener: input.listener,
          criteria: input.criteria,
          keep: input.keep,
          improve: input.improve,
          managerSummary: input.managerSummary,
          nextTask: input.nextTask,
          scheduleId: input.scheduleId,
        });
        if (input.scheduleId) listening.completeSchedule(input.scheduleId);
        return { score: computeFeedbackScore(input.criteria), scheduleCompleted: !!input.scheduleId };
      }
      const res = await createFeedbackSrv({
        data: {
          representative_id: input.repId,
          schedule_id: input.scheduleId,
          ...toServerFields(input),
        },
      });
      // The evaluation and the session's completion commit together, so both
      // collections must be re-read together.
      await refetch("feedback", "listening_schedules");
      return { score: res.score, scheduleCompleted: res.schedule_completed };
    },
    [isDemo, app, listening, createFeedbackSrv, refetch],
  );

  const updateFeedback = useCallback(
    async (input: FeedbackFormFields & { id: string; expectedUpdatedAt: string | null; reason?: string }) => {
      if (isDemo) {
        app.updateFeedback(input.id, {
          date: input.date,
          callId: input.callId,
          callType: input.callType,
          listener: input.listener,
          criteria: input.criteria,
          keep: input.keep,
          improve: input.improve,
          managerSummary: input.managerSummary,
          nextTask: input.nextTask,
        });
        return { score: computeFeedbackScore(input.criteria), wasPublished: false, representativeNotified: false };
      }
      const res = await updateFeedbackSrv({
        data: {
          feedback_id: input.id,
          expected_updated_at: input.expectedUpdatedAt,
          reason: input.reason,
          ...toServerFields(input),
        },
      });
      await refetch("feedback");
      return {
        score: res.score,
        wasPublished: res.was_published,
        representativeNotified: res.representative_notified,
      };
    },
    [isDemo, app, updateFeedbackSrv, refetch],
  );

  const setPublished = useCallback(
    async (input: { id: string; published: boolean; reason?: string }) => {
      if (isDemo) {
        app.updateFeedback(input.id, { published: input.published });
        return { published: input.published, changed: true };
      }
      const res = await setPublishedSrv({
        data: { feedback_id: input.id, published: input.published, reason: input.reason },
      });
      await refetch("feedback");
      return { published: res.published, changed: res.changed };
    },
    [isDemo, app, setPublishedSrv, refetch],
  );

  const assignArticle = useCallback(
    async (input: { repId: string; articleId: string; dueOn: string | null }) => {
      const res = await assignArticleSrv({
        data: { representative_id: input.repId, article_id: input.articleId, due_on: input.dueOn },
      });
      await refetch("rep_tasks");
      return res;
    },
    [assignArticleSrv, refetch],
  );

  const saveCoachingPlan = useCallback(
    async (input: {
      repId: string;
      targetScore: number;
      reviewOn: string;
      focusSections: string;
      notes: string;
      bookReview: boolean;
      reviewTime: string;
    }) => {
      const res = await saveCoachingPlanSrv({
        data: {
          representative_id: input.repId,
          target_score: input.targetScore,
          review_on: input.reviewOn,
          focus_sections: input.focusSections,
          notes: input.notes,
          book_review: input.bookReview,
          review_time: input.reviewTime,
        },
      });
      await refetch("coaching_plans", "listening_schedules");
      return res;
    },
    [saveCoachingPlanSrv, refetch],
  );

  const createSchedule = useCallback(
    async (input: { repId: string; date: string; time: string; topic: string }) => {
      if (isDemo) {
        listening.addSchedule({ repId: input.repId, date: input.date, time: input.time, topic: input.topic });
        return;
      }
      await createScheduleSrv({
        data: {
          representative_id: input.repId,
          scheduled_on: input.date,
          scheduled_time: input.time,
          topic: input.topic,
        },
      });
      await refetch("listening_schedules");
    },
    [isDemo, listening, createScheduleSrv, refetch],
  );

  const updateSchedule = useCallback(
    async (input: { id: string; date?: string; time?: string; topic?: string; status?: string }) => {
      if (isDemo) {
        listening.updateSchedule(input.id, {
          date: input.date,
          time: input.time,
          topic: input.topic,
          status: input.status as Parameters<typeof listening.updateSchedule>[1]["status"],
        });
        return;
      }
      await updateScheduleSrv({
        data: {
          schedule_id: input.id,
          scheduled_on: input.date,
          scheduled_time: input.time,
          topic: input.topic,
          status: input.status,
        },
      });
      await refetch("listening_schedules");
    },
    [isDemo, listening, updateScheduleSrv, refetch],
  );

  const deleteSchedule = useCallback(
    async (id: string) => {
      if (isDemo) {
        listening.removeSchedule(id);
        return;
      }
      await deleteScheduleSrv({ data: { schedule_id: id } });
      await refetch("listening_schedules", "coaching_plans");
    },
    [isDemo, listening, deleteScheduleSrv, refetch],
  );

  return {
    /**
     * Whether actions that exist only against real cloud data (article
     * assignment, coaching-plan persistence) can actually store anything.
     * Demo Mode has no rep_tasks/coaching_plans tables behind it, so the UI
     * disables those controls and says why instead of faking a success.
     */
    canPersistCoaching: !isDemo,
    createFeedback,
    updateFeedback,
    setPublished,
    assignArticle,
    saveCoachingPlan,
    createSchedule,
    updateSchedule,
    deleteSchedule,
  };
}

/** Convenience: how many of these evaluations are still unpublished drafts. */
export function countDrafts(list: Feedback[]): number {
  return list.filter((f) => !f.published).length;
}
