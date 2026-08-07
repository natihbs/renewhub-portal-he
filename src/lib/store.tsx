import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  SEED,
  type AppState,
  type Rep,
  type Announcement,
  type Competition,
  type CompetitionCategory,
  type Article,
  type ArticleCategory,
  type Role,
  UNASSIGNED_TEAM_LABEL,
} from "./seed";
import { computeFeedbackScore, type Feedback, type CriterionValue } from "./feedback-domain";
import { competitionStandings } from "./home-domain";
import type { KpiValueRow } from "./kpi-values";
import { useCloudCollection } from "@/lib/cloud-hooks";
import { useAppMode } from "@/lib/app-mode";
import { useAuth } from "@/lib/auth";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listRepresentatives } from "@/lib/rep-admin.functions";

type Ctx = {
  state: AppState;
  setRole: (r: Role) => void;
  setCurrentRep: (id: string) => void;
  // reps
  addRep: (r: Omit<Rep, "id">) => void;
  updateRep: (id: string, patch: Partial<Rep>) => void;
  replaceReps: (reps: Rep[]) => void;

  removeRep: (id: string) => void;
  // announcements
  addAnnouncement: (a: Omit<Announcement, "id" | "date">) => void;
  updateAnnouncement: (id: string, patch: Partial<Announcement>) => void;
  removeAnnouncement: (id: string) => void;
  // competitions
  addCompetition: (c: Omit<Competition, "id" | "scores" | "active" | "archived"> & { active?: boolean }) => void;
  updateCompetition: (id: string, patch: Partial<Competition>) => void;
  addCompetitionCategory: (compId: string, cat: Omit<CompetitionCategory, "id">) => void;
  removeCompetitionCategory: (compId: string, catId: string) => void;
  setCompetitionScore: (compId: string, repId: string, catId: string, count: number) => void;
  closeCompetition: (id: string) => void;
  /**
   * Only allowed when the competition has no recorded scores (count > 0) —
   * see hasRecordedScores in competitions.tsx. Anything with real history
   * must be archived, not deleted, so completed competitions never become
   * unmanageable dead ends but their record also can't silently disappear.
   */
  deleteCompetition: (id: string) => void;
  // articles
  addArticle: (a: Omit<Article, "id" | "updatedAt">) => void;
  updateArticle: (id: string, patch: Partial<Article>) => void;
  removeArticle: (id: string) => void;
  // feedback
  // updatedAt/publishedAt are lifecycle fields the writer assigns, never
  // caller input — the caller cannot know either one.
  addFeedback: (f: Omit<Feedback, "id" | "score" | "published" | "updatedAt" | "publishedAt"> & { score?: number }) => void;
  updateFeedback: (id: string, patch: Partial<Omit<Feedback, "id">>) => void;
  resetAll: () => void;
};

type AnnouncementRow = { id: string; title: string; body: string; published_on: string };
type ArticleRow = {
  id: string;
  title: string;
  category: string;
  summary: string;
  body: string;
  read_minutes: number;
  important: boolean;
  updated_at: string;
};
type CompetitionRow = {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  rules: string;
  prize: string;
  active: boolean;
  archived: boolean;
};
type CompetitionCategoryRow = { id: string; competition_id: string; label: string; points: number };
type CompetitionScoreRow = {
  id: string;
  competition_id: string;
  category_id: string;
  representative_id: string;
  count: number;
};
type FeedbackRow = {
  id: string;
  representative_id: string;
  feedback_date: string;
  call_id: string;
  call_type: string;
  listener: string;
  criteria: Record<string, CriterionValue>;
  score: number;
  keep_doing: string;
  improve: string;
  manager_summary: string;
  next_task: string;
  published: boolean;
  published_at: string | null;
  schedule_id: string | null;
  updated_at: string;
};

const AppCtx = createContext<Ctx | null>(null);
const uid = () => Math.random().toString(36).slice(2, 10);
const todayIso = () => new Date().toISOString().slice(0, 10);

/**
 * Business data lives in the cloud. Local state only holds ephemeral UI
 * selection (active role view / selected representative) plus the cloud
 * representatives mirror written by CloudRepsSync.
 */
export function AppProvider({ children }: { children: ReactNode }) {
  const [role, setRoleState] = useState<Role>("manager");
  const [currentRepId, setCurrentRepId] = useState<string>("");
  const [reps, setReps] = useState<Rep[]>([]);
  const [demo, setDemo] = useState<AppState>(SEED);
  const { isAdmin, isManager, user } = useAuth();
  const { isDemo } = useAppMode();

  const announcements = useCloudCollection<AnnouncementRow>("announcements", {
    order: { column: "published_on" },
  });
  const articles = useCloudCollection<ArticleRow>("articles", { order: { column: "updated_at" } });
  const competitions = useCloudCollection<CompetitionRow>("competitions", {
    order: { column: "start_date" },
  });
  const compCategories = useCloudCollection<CompetitionCategoryRow>("competition_categories", {
    order: { column: "created_at", ascending: true },
  });
  const compScores = useCloudCollection<CompetitionScoreRow>("competition_scores", {});
  // A plain representative only ever needs their own feedback — eq-scope it. A
  // manager/admin needs every rep they can manage; `reps` is already exactly that set
  // (listRepresentatives is RLS-scoped the same way — manager's own team, admin sees
  // all), so we reuse it as an `in` filter instead of fetching the whole table. Gated
  // on the relevant id(s) actually being resolved yet, so this never briefly
  // over-fetches (rep) or queries an empty `in: []` (manager) while reps are still loading.
  const isRepOnly = !isAdmin && !isManager;
  const repIds = useMemo(() => reps.map((r) => r.id), [reps]);

  /**
   * Async status of the representatives list. `reps` itself is a mirror
   * written by CloudRepsSync, which strips the loading/error signal — so an
   * empty mirror meant "no representatives", "still loading" and "the query
   * failed" indistinguishably, and the dashboard rendered the first of those
   * for all three. Observing the SAME query key here is free: TanStack
   * dedupes by key, so this adds no network round trip.
   */
  const loadReps = useServerFn(listRepresentatives);
  const repsQuery = useQuery({
    queryKey: ["representatives"],
    queryFn: () => loadReps(),
    enabled: !isDemo && !!user,
    staleTime: 30_000,
  });
  const repsLoading = repsQuery.isLoading;
  const repsError = repsQuery.isError ? "שגיאה בטעינת רשימת הנציגים" : null;
  const feedback = useCloudCollection<FeedbackRow>("feedback", {
    order: { column: "feedback_date" },
    eq: isRepOnly && currentRepId ? { representative_id: currentRepId } : undefined,
    in: !isRepOnly && repIds.length > 0 ? { representative_id: repIds } : undefined,
    enabled: isRepOnly ? !!currentRepId : repIds.length > 0,
  });
  // Same scoping as feedback — never fetched for renewal calculations elsewhere;
  // only ever read via src/lib/kpi-values.ts's aggregation helpers.
  const kpiValues = useCloudCollection<KpiValueRow>("kpi_values", {
    order: { column: "metric_date" },
    eq: isRepOnly && currentRepId ? { representative_id: currentRepId } : undefined,
    in: !isRepOnly && repIds.length > 0 ? { representative_id: repIds } : undefined,
    enabled: isRepOnly ? !!currentRepId : repIds.length > 0,
  });

  /**
   * §P2 historical team attribution, client side.
   *
   * kpi_values RLS already grants a manager rows ATTRIBUTED to a team they
   * manage — "kpi_values manager read" is
   *     can_manage_rep(representative_id) OR manages_team(team_id)
   * precisely so a team keeps its history after a representative moves on.
   * The client then threw that away: the query above filters
   * `representative_id IN (current roster)`, so rows produced FOR this team
   * by someone who has since transferred or been deactivated never arrived,
   * and renewalTotalsForTeamHistorical silently under-reported. A team's
   * recorded history shrank when a person left.
   *
   * This second read fetches by the immutable attribution instead. The two
   * are merged below and de-duplicated by row id, so a rep still on the team
   * contributes exactly once.
   */
  const managedTeamIds = useMemo(
    () => [...new Set(reps.map((r) => r.teamId).filter((t): t is string => !!t))].sort(),
    [reps],
  );
  const kpiByTeam = useCloudCollection<KpiValueRow>("kpi_values", {
    order: { column: "metric_date" },
    in: !isRepOnly && managedTeamIds.length > 0 ? { team_id: managedTeamIds } : undefined,
    enabled: !isRepOnly && managedTeamIds.length > 0,
  });
  const mergedKpiValues = useMemo(() => {
    if (isRepOnly) return kpiValues.rows;
    const byId = new Map<string, KpiValueRow>();
    for (const row of kpiValues.rows) byId.set(row.id, row);
    for (const row of kpiByTeam.rows) byId.set(row.id, row);
    return [...byId.values()];
  }, [isRepOnly, kpiValues.rows, kpiByTeam.rows]);

  const live = announcements.live;

  // A representative's identity is never chosen in the UI in Live Mode (the role/rep
  // switcher is demo-only) — resolve it from `reps`, which CloudRepsSync already
  // populates from listRepresentatives(). For a caller with no elevated role, that
  // query is RLS-scoped to exactly their own representatives row ("representatives
  // self read": user_id = auth.uid()) — the same authoritative link
  // (representatives.user_id) every other part of the backend trusts.
  //
  // This intentionally does NOT read profiles.representative_id — that's a legacy,
  // display-only column (see resolveBusinessIdentifier in team-admin.functions.ts)
  // that linkRepresentativeToUserCore, the actual admin linking path, never writes.
  // A rep linked through the Representatives page or the Users page's Link
  // Representative action would have a correct representatives.user_id but a null
  // profiles.representative_id, and previously saw a permanently empty app as a
  // result — reusing `reps` here (rather than a second, redundant query) fixes that
  // for every representative-facing surface at once.
  useEffect(() => {
    if (live && !currentRepId && isRepOnly && reps.length > 0) {
      setCurrentRepId(reps[0].id);
    }
  }, [live, currentRepId, isRepOnly, reps]);

  const replaceReps = useCallback((next: Rep[]) => setReps(next), []);

  const state: AppState = useMemo(() => {
    if (!live) return { ...demo, role, currentRepId: currentRepId || demo.currentRepId };
    return {
      role,
      currentRepId,
      reps,
      announcements: announcements.rows.map((a) => ({
        id: a.id,
        title: a.title,
        body: a.body,
        date: a.published_on,
      })),
      articles: articles.rows.map((a) => ({
        id: a.id,
        title: a.title,
        category: a.category as ArticleCategory,
        summary: a.summary,
        body: a.body,
        readMinutes: a.read_minutes,
        important: a.important,
        updatedAt: a.updated_at.slice(0, 10),
      })),
      competitions: competitions.rows.map((c) => ({
        id: c.id,
        name: c.name,
        startDate: c.start_date,
        endDate: c.end_date,
        rules: c.rules,
        prize: c.prize,
        active: c.active,
        archived: c.archived,
        categories: compCategories.rows
          .filter((k) => k.competition_id === c.id)
          .map((k) => ({ id: k.id, label: k.label, points: k.points })),
        scores: compScores.rows
          .filter((s) => s.competition_id === c.id)
          .map((s) => ({ repId: s.representative_id, categoryId: s.category_id, count: s.count })),
      })),
      feedback: feedback.rows.map((f) => ({
        id: f.id,
        repId: f.representative_id,
        date: f.feedback_date,
        callId: f.call_id,
        callType: f.call_type,
        listener: f.listener,
        criteria: f.criteria ?? {},
        score: f.score,
        keep: f.keep_doing,
        improve: f.improve,
        managerSummary: f.manager_summary,
        nextTask: f.next_task,
        published: f.published,
        scheduleId: f.schedule_id,
        updatedAt: f.updated_at,
        publishedAt: f.published_at ?? null,
      })),
      feedbackLoading: feedback.isLoading,
      feedbackError: feedback.isError ? (feedback.error?.message ?? "שגיאה בטעינת נתוני משוב") : null,
      repsLoading,
      repsError,
      kpiLoading: kpiValues.isLoading || kpiByTeam.isLoading,
      kpiError: kpiValues.isError || kpiByTeam.isError ? "שגיאה בטעינת נתוני חידושים" : null,
      kpiValues: mergedKpiValues,
    };
  }, [live, demo, role, currentRepId, reps, repsLoading, repsError, announcements.rows, articles.rows, competitions.rows, compCategories.rows, compScores.rows, feedback.rows, feedback.isLoading, feedback.isError, feedback.error, mergedKpiValues, kpiValues.isLoading, kpiValues.isError, kpiByTeam.isLoading, kpiByTeam.isError]);

  const value: Ctx = useMemo(() => {
    const shared = {
      state,
      setRole: (r: Role) => setRoleState(r),
      setCurrentRep: (id: string) => setCurrentRepId(id),
      replaceReps,
    };

    if (!live) {
      const patch = (fn: (s: AppState) => AppState) => setDemo(fn);
      return {
        ...shared,
        addRep: (r) => patch((s) => ({ ...s, reps: [...s.reps, { ...r, id: uid() }] })),
        updateRep: (id, p) => patch((s) => ({ ...s, reps: s.reps.map((x) => (x.id === id ? { ...x, ...p } : x)) })),
        removeRep: (id) => patch((s) => ({ ...s, reps: s.reps.filter((x) => x.id !== id) })),
        addAnnouncement: (a) =>
          patch((s) => ({ ...s, announcements: [{ ...a, id: uid(), date: todayIso() }, ...s.announcements] })),
        updateAnnouncement: (id, p) =>
          patch((s) => ({ ...s, announcements: s.announcements.map((a) => (a.id === id ? { ...a, ...p } : a)) })),
        removeAnnouncement: (id) =>
          patch((s) => ({ ...s, announcements: s.announcements.filter((a) => a.id !== id) })),
        addCompetition: (c) =>
          patch((s) => ({
            ...s,
            competitions: [...s.competitions, { ...c, id: uid(), scores: [], active: c.active ?? true, archived: false }],
          })),
        updateCompetition: (id, p) =>
          patch((s) => ({ ...s, competitions: s.competitions.map((c) => (c.id === id ? { ...c, ...p } : c)) })),
        addCompetitionCategory: (compId, cat) =>
          patch((s) => ({
            ...s,
            competitions: s.competitions.map((c) =>
              c.id === compId ? { ...c, categories: [...c.categories, { ...cat, id: uid() }] } : c,
            ),
          })),
        removeCompetitionCategory: (compId, catId) =>
          patch((s) => ({
            ...s,
            competitions: s.competitions.map((c) =>
              c.id === compId
                ? {
                    ...c,
                    categories: c.categories.filter((k) => k.id !== catId),
                    scores: c.scores.filter((sc) => sc.categoryId !== catId),
                  }
                : c,
            ),
          })),
        setCompetitionScore: (compId, repId, catId, count) =>
          patch((s) => ({
            ...s,
            competitions: s.competitions.map((c) => {
              if (c.id !== compId) return c;
              const idx = c.scores.findIndex((sc) => sc.repId === repId && sc.categoryId === catId);
              const scores = [...c.scores];
              if (idx >= 0) scores[idx] = { ...scores[idx], count };
              else scores.push({ repId, categoryId: catId, count });
              return { ...c, scores };
            }),
          })),
        closeCompetition: (id) =>
          patch((s) => ({
            ...s,
            competitions: s.competitions.map((c) => (c.id === id ? { ...c, active: false } : c)),
          })),
        deleteCompetition: (id) =>
          patch((s) => ({ ...s, competitions: s.competitions.filter((c) => c.id !== id) })),
        addArticle: (a) =>
          patch((s) => ({ ...s, articles: [{ ...a, id: uid(), updatedAt: todayIso() }, ...s.articles] })),
        updateArticle: (id, p) =>
          patch((s) => ({
            ...s,
            articles: s.articles.map((a) => (a.id === id ? { ...a, ...p, updatedAt: todayIso() } : a)),
          })),
        removeArticle: (id) => patch((s) => ({ ...s, articles: s.articles.filter((a) => a.id !== id) })),
        addFeedback: (f) => {
          const score = f.score ?? computeScore(f.criteria);
          patch((s) => ({
            ...s,
            feedback: [
              { ...f, id: uid(), score, published: false, updatedAt: new Date().toISOString(), publishedAt: null },
              ...s.feedback,
            ],
          }));
        },
        updateFeedback: (id, p) =>
          patch((s) => ({
            ...s,
            feedback: s.feedback.map((f) => {
              if (f.id !== id) return f;
              const next = { ...f, ...p, updatedAt: new Date().toISOString() };
              return {
                ...next,
                score: p.criteria ? computeScore(next.criteria) : next.score,
                publishedAt: p.published === true ? (f.publishedAt ?? new Date().toISOString()) : p.published === false ? null : next.publishedAt,
              };
            }),
          })),
        resetAll: () => setDemo(SEED),
      };
    }

    return {
      ...shared,
      // Representatives are managed through the dedicated cloud module.
      addRep: () => {},
      updateRep: () => {},
      removeRep: () => {},
      addAnnouncement: (a) =>
        void announcements.insert({ title: a.title, body: a.body, published_on: todayIso() }, "created_by"),
      updateAnnouncement: (id, p) => {
        const row: Record<string, string> = {};
        if (p.title !== undefined) row.title = p.title;
        if (p.body !== undefined) row.body = p.body;
        if (p.date !== undefined) row.published_on = p.date;
        void announcements.update(id, row);
      },
      removeAnnouncement: (id) => void announcements.remove(id),
      addCompetition: (c) =>
        void competitions
          .insert(
            {
              name: c.name,
              start_date: c.startDate,
              end_date: c.endDate,
              rules: c.rules,
              prize: c.prize,
              active: c.active ?? true,
            },
            "created_by",
          )
          .then((row) => {
            for (const cat of c.categories ?? []) {
              void compCategories.insert({
                competition_id: row.id,
                label: cat.label,
                points: cat.points,
              });
            }
          }),
      updateCompetition: (id, p) => {
        const row: Record<string, string | boolean> = {};
        if (p.name !== undefined) row.name = p.name;
        if (p.startDate !== undefined) row.start_date = p.startDate;
        if (p.endDate !== undefined) row.end_date = p.endDate;
        if (p.rules !== undefined) row.rules = p.rules;
        if (p.prize !== undefined) row.prize = p.prize;
        if (p.active !== undefined) row.active = p.active;
        if (p.archived !== undefined) row.archived = p.archived;
        void competitions.update(id, row);
      },
      addCompetitionCategory: (compId, cat) =>
        void compCategories.insert({ competition_id: compId, label: cat.label, points: cat.points }),
      removeCompetitionCategory: (_compId, catId) => void compCategories.remove(catId),
      setCompetitionScore: (compId, repId, catId, count) =>
        void compScores.upsert(
          { competition_id: compId, category_id: catId, representative_id: repId, count },
          "competition_id,category_id,representative_id",
        ),
      closeCompetition: (id) => void competitions.update(id, { active: false }),
      deleteCompetition: (id) => void competitions.remove(id),
      addArticle: (a) =>
        void articles.insert(
          {
            title: a.title,
            category: a.category,
            summary: a.summary,
            body: a.body,
            read_minutes: a.readMinutes,
            important: a.important,
          },
          "created_by",
        ),
      updateArticle: (id, p) => {
        const row: Record<string, string | number | boolean> = {};
        if (p.title !== undefined) row.title = p.title;
        if (p.category !== undefined) row.category = p.category;
        if (p.summary !== undefined) row.summary = p.summary;
        if (p.body !== undefined) row.body = p.body;
        if (p.readMinutes !== undefined) row.read_minutes = p.readMinutes;
        if (p.important !== undefined) row.important = p.important;
        void articles.update(id, row);
      },
      removeArticle: (id) => void articles.remove(id),
      // §Feedback hardening: in Live Mode these no longer exist as generic
      // cloud writes. An evaluation needs a server-derived score, a
      // future-date rule, optimistic concurrency, a revision row written in
      // the same transaction as the change, and a publish that is its own
      // audited act — none of which the generic proxy can provide (it
      // forwarded whatever the browser asserted, fire-and-forget, and the
      // caller was told it had succeeded either way).
      //
      // These throw rather than no-op deliberately: a silent no-op is the
      // exact failure mode this sprint exists to remove. Every real caller
      // goes through useFeedbackActions() (src/lib/feedback-hooks.ts), and
      // `feedback` is now on CLOUD_WRITE_PROTECTED_TABLES so the old route is
      // closed at the server boundary too.
      addFeedback: () => {
        throw new Error("שמירת משוב במצב מחובר מתבצעת דרך useFeedbackActions().createFeedback");
      },
      updateFeedback: () => {
        throw new Error("עדכון משוב במצב מחובר מתבצע דרך useFeedbackActions().updateFeedback");
      },
      resetAll: () => {},
    };
  }, [state, live, replaceReps, announcements, articles, competitions, compCategories, compScores, feedback]);

  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

export function useApp() {
  const ctx = useContext(AppCtx);
  if (!ctx) throw new Error("useApp outside provider");
  return ctx;
}

/**
 * Real authorization gate: in Live Mode this reflects the signed-in user's
 * actual Supabase role (admin/manager), never the local demo role switcher.
 * Demo Mode keeps using the in-memory demo role flag. RLS remains the final
 * authorization boundary for any cloud write regardless of what this returns.
 */
export function useIsManager() {
  const { isDemo } = useAppMode();
  const { isAdmin, isManager } = useAuth();
  const { state } = useApp();
  if (isDemo) return state.role === "manager";
  return isAdmin || isManager;
}

// Derived helpers
/**
 * Re-export of the single canonical implementation in feedback-domain.ts,
 * which the server now shares (§P1 — the score is no longer client-asserted).
 * Kept as a named export here so existing call sites are unaffected.
 */
export const computeScore = computeFeedbackScore;

/**
 * Single source of truth for "which feedback rows can this viewer see" on the client
 * side. A manager/admin sees everything (including drafts) for the reps they manage;
 * a representative only ever sees their own PUBLISHED feedback. This mirrors — but
 * does not replace — the real boundary enforced by RLS (can_manage_rep / published AND
 * rep_is_self) on the feedback table itself.
 */
export function visibleFeedback(list: Feedback[], isManager: boolean, currentRepId: string): Feedback[] {
  if (isManager) return list;
  if (!currentRepId) return [];
  return list.filter((f) => f.repId === currentRepId && f.published);
}

/**
 * Distinct teams actually present among the given reps, in first-seen order.
 * Used to render per-team UI dynamically instead of hardcoding a fixed set of teams.
 * Does NOT include empty teams that have no reps yet — use useCloudTeams() for pickers
 * that must offer every active team (including brand-new, still-empty ones).
 */
export function teamsFromReps(reps: Rep[]): { teamId: string; teamName: string }[] {
  const map = new Map<string, string>();
  for (const r of reps) {
    if (r.teamId) map.set(r.teamId, r.teamName || UNASSIGNED_TEAM_LABEL);
  }
  return Array.from(map, ([teamId, teamName]) => ({ teamId, teamName }));
}

/**
 * Points per representative, highest first.
 *
 * Delegates to home-domain's competitionStandings so the scoring formula has
 * exactly one implementation — the home screens show a representative their own
 * position in the same competition this leaderboard renders, and two copies of
 * "points × count summed over categories" would eventually disagree. The rows
 * additionally carry `rank`; existing callers that only read repId/total are
 * unaffected.
 */
export function competitionLeaderboard(comp: Competition) {
  return competitionStandings(comp);
}
