// Readiness + pace rules for the Morning Routine manager notifications.
//
// Two defects this module closes, both of which produced notifications that
// contradicted the screen that generated them:
//
//  1. PACE. The alert fired on `achievementPct < 80` — a flat month-end
//     threshold. On the 3rd working day of a 22-day month a team at 30% of the
//     monthly target is comfortably AHEAD, and was still told it was behind.
//     The canonical workday-aware primitive (paceStatus, the same one the
//     Performance dashboard and RepWorkspace use) now decides.
//  2. READINESS. A one-shot `notifiedRef` fired on the first render that had
//     any representatives, whether or not KPI values, goals, feedback,
//     schedules or underwriting had loaded — so alerts were derived from
//     half-loaded (or failed) data, and could never be re-evaluated once the
//     real data arrived, nor after a team switch, a day rollover or a failed
//     delivery.
//
// Pure and dependency-free; the component holds only the refs.

import { paceStatus } from "@/lib/performance-domain";

export type SourceLoadState = "loading" | "error" | "ready";

/** Every async source a notification decision reads from. */
export type NotificationSources = {
  representatives: SourceLoadState;
  kpiValues: SourceLoadState;
  goals: SourceLoadState;
  feedback: SourceLoadState;
  schedules: SourceLoadState;
  underwriting: SourceLoadState;
  competitions: SourceLoadState;
};

/**
 * Notifications are evaluated only from data that is fully loaded and
 * error-free. A single loading or failed source blocks the whole evaluation:
 * a partial picture would produce alerts about gaps that only exist because
 * the rows had not arrived yet.
 */
export function notificationSourcesReady(sources: NotificationSources): boolean {
  return Object.values(sources).every((s) => s === "ready");
}

/** Sources that are not ready, for diagnostics/tests. */
export function notReadySources(sources: NotificationSources): string[] {
  return Object.entries(sources)
    .filter(([, s]) => s !== "ready")
    .map(([k]) => k);
}

export type PaceNotificationInput = {
  actual: number;
  /** The official monthly team target, or null when none is set. */
  target: number | null;
  workdaysTotal: number;
  workdaysPassed: number;
};

/**
 * "Behind pace" for notification purposes is the SAME band the dashboard
 * shows: paceStatus === "attention". No alert at all when there is no usable
 * target, when the month has no elapsed working days yet, or when the team is
 * ahead of / on the expected pace — so strong early-month progress is never
 * labeled behind.
 */
export function shouldNotifyPace(input: PaceNotificationInput): boolean {
  const { actual, target, workdaysTotal, workdaysPassed } = input;
  if (target === null || !Number.isFinite(target) || target <= 0) return false;
  if (!Number.isFinite(workdaysTotal) || workdaysTotal <= 0) return false;
  if (!Number.isFinite(workdaysPassed) || workdaysPassed < 1) return false;
  return paceStatus(actual, target, workdaysTotal, workdaysPassed) === "attention";
}

/**
 * Identity of one evaluation. Delivery is remembered against this key, so the
 * same facts are never re-sent on every render, while a real change — team,
 * user, business date, or any figure an alert is derived from — produces a new
 * key and a fresh evaluation.
 */
export function notificationEvaluationKey(parts: {
  userId: string | null;
  teamId: string | null;
  businessDate: string;
  signature: (string | number)[];
}): string | null {
  if (!parts.userId || !parts.teamId) return null;
  return [parts.userId, parts.teamId, parts.businessDate, ...parts.signature.map(String)].join("|");
}

export const MAX_NOTIFICATION_ATTEMPTS = 3;

export type EvaluationGateState = {
  ready: boolean;
  key: string | null;
  /** Key whose delivery already SUCCEEDED. */
  deliveredKey: string | null;
  /** Key of the most recent failed delivery, if any. */
  failedKey: string | null;
  failedAttempts: number;
  inFlight: boolean;
};

/**
 * Whether to evaluate + deliver now. A failed delivery deliberately does NOT
 * consume the key permanently — it may be retried up to
 * MAX_NOTIFICATION_ATTEMPTS, which bounds the retry so a persistent server
 * error cannot become a render/request loop.
 */
export function shouldEvaluateNotifications(state: EvaluationGateState): boolean {
  if (!state.ready || state.inFlight || !state.key) return false;
  if (state.deliveredKey === state.key) return false;
  if (state.failedKey === state.key && state.failedAttempts >= MAX_NOTIFICATION_ATTEMPTS) return false;
  return true;
}

/**
 * Outcome of one delivery call. `failed > 0` means the server could not write
 * at least one notification, which is retryable; a pure dedupe skip is a
 * SUCCESS and must consume the evaluation key.
 */
export function deliveryFailed(result: { delivered?: number; skipped?: number; failed?: number } | null | undefined): boolean {
  if (!result) return true;
  return (result.failed ?? 0) > 0;
}
