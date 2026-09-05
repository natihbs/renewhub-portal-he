// Honest evaluation of "did this source actually refetch?".
//
// runFreshnessCheck used to do `await qc.refetchQueries({ queryKey })` inside a
// try/catch and call that source ok. React Query's refetchQueries does NOT
// reject on a failed fetch unless `throwOnError` is set, and it resolves
// happily when the key matched NOTHING at all, or matched only disabled /
// paused / never-fetched queries. Every one of those returned "ok", so a check
// could report "complete" while nothing had been refreshed.
//
// The rule set below is pure so each failure mode is unit-tested without a
// query client.

export type ObservedQuery = {
  status: "pending" | "success" | "error";
  fetchStatus: "fetching" | "paused" | "idle";
  /** 0 when the query has never completed a successful fetch. */
  dataUpdatedAt: number;
};

export type SourceOutcome = { ok: boolean; error?: string };

export const REFETCH_NO_QUERY_MESSAGE = "המקור אינו טעון במסך זה — לא בוצע רענון";
export const REFETCH_FAILED_MESSAGE = "הרענון נכשל";
export const REFETCH_INCOMPLETE_MESSAGE = "הרענון לא הושלם";

/**
 * A source counts as refreshed only when the refetch call itself did not
 * throw, at least one query matched the key, and EVERY matched query ended in
 * a completed successful fetch. Anything else is reported as a real failure
 * with a source-specific reason.
 */
export function evaluateSourceOutcome(
  queries: ObservedQuery[],
  thrown?: unknown,
): SourceOutcome {
  if (thrown !== undefined && thrown !== null) {
    const message = thrown instanceof Error ? thrown.message : String(thrown);
    return { ok: false, error: message || REFETCH_FAILED_MESSAGE };
  }
  if (queries.length === 0) return { ok: false, error: REFETCH_NO_QUERY_MESSAGE };
  if (queries.some((q) => q.status === "error")) return { ok: false, error: REFETCH_FAILED_MESSAGE };
  const allSettled = queries.every(
    (q) => q.status === "success" && q.fetchStatus === "idle" && q.dataUpdatedAt > 0,
  );
  return allSettled ? { ok: true } : { ok: false, error: REFETCH_INCOMPLETE_MESSAGE };
}
