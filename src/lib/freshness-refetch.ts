// Honest evaluation of "did this source actually refetch?".
//
// refetchQueries resolves even when the key matched NOTHING, when every match
// was disabled/paused, or when the fetch failed (without throwOnError). And a
// past successful fetch (dataUpdatedAt > 0) proves nothing about THIS check —
// only a rising dataUpdateCount/errorUpdateCount does. So each source is
// judged on a before/after snapshot of its eligible queries.

export type QuerySnapshot = {
  /** Stable identity of the cached query (hash of its key). */
  hash: string;
  status: "pending" | "success" | "error";
  fetchStatus: "fetching" | "paused" | "idle";
  /** Increments on every completed successful fetch. */
  dataUpdateCount: number;
  /** True when the query has no active observer / is disabled. */
  disabled: boolean;
};

export type SourceOutcome = { ok: boolean; error?: string };

export const REFETCH_NO_QUERY_MESSAGE = "המקור אינו טעון במסך זה — לא בוצע רענון";
export const REFETCH_FAILED_MESSAGE = "הרענון נכשל";
export const REFETCH_INCOMPLETE_MESSAGE = "הרענון לא הושלם";

/**
 * A source counts as refreshed only when:
 *   - the refetch call did not throw (throwOnError is enabled by the caller),
 *   - at least one ELIGIBLE (active, non-disabled) query matched the key,
 *   - and every eligible query ended settled, successful, and with a
 *     dataUpdateCount strictly greater than its value before the refetch.
 * Disabled/inactive historical queries are ignored when at least one eligible
 * query exists; when none exists the source is explicitly unavailable.
 */
export function evaluateSourceOutcome(
  before: QuerySnapshot[],
  after: QuerySnapshot[],
  thrown?: unknown,
): SourceOutcome {
  if (thrown !== undefined && thrown !== null) {
    const message = thrown instanceof Error ? thrown.message : String(thrown);
    return { ok: false, error: message || REFETCH_FAILED_MESSAGE };
  }

  const eligible = after.filter((q) => !q.disabled);
  if (eligible.length === 0) return { ok: false, error: REFETCH_NO_QUERY_MESSAGE };
  if (eligible.some((q) => q.status === "error")) return { ok: false, error: REFETCH_FAILED_MESSAGE };

  const beforeByHash = new Map(before.map((q) => [q.hash, q]));
  const refreshed = eligible.every((q) => {
    if (q.status !== "success" || q.fetchStatus !== "idle") return false;
    const prev = beforeByHash.get(q.hash);
    const prevCount = prev ? prev.dataUpdateCount : 0;
    return q.dataUpdateCount > prevCount;
  });
  return refreshed ? { ok: true } : { ok: false, error: REFETCH_INCOMPLETE_MESSAGE };
}
