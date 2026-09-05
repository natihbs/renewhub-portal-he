import { describe, it, expect } from "vitest";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import {
  evaluateSourceOutcome,
  REFETCH_NO_QUERY_MESSAGE,
  REFETCH_FAILED_MESSAGE,
  REFETCH_INCOMPLETE_MESSAGE,
  type QuerySnapshot,
} from "@/lib/freshness-refetch";

const snap = (p: Partial<QuerySnapshot> = {}): QuerySnapshot => ({
  hash: "h",
  status: "success",
  fetchStatus: "idle",
  dataUpdateCount: 2,
  disabled: false,
  ...p,
});

describe("evaluateSourceOutcome", () => {
  it("fails when no query matched the key", () => {
    expect(evaluateSourceOutcome([], [])).toEqual({ ok: false, error: REFETCH_NO_QUERY_MESSAGE });
  });

  it("fails when every match is disabled/inactive", () => {
    const q = snap({ disabled: true });
    expect(evaluateSourceOutcome([q], [q]).error).toBe(REFETCH_NO_QUERY_MESSAGE);
  });

  it("does NOT accept a historical success — the count must rise", () => {
    const before = snap({ dataUpdateCount: 5 });
    expect(evaluateSourceOutcome([before], [snap({ dataUpdateCount: 5 })]).error).toBe(
      REFETCH_INCOMPLETE_MESSAGE,
    );
    expect(evaluateSourceOutcome([before], [snap({ dataUpdateCount: 6 })])).toEqual({ ok: true });
  });

  it("fails on error, paused and still-fetching states", () => {
    expect(evaluateSourceOutcome([], [snap({ status: "error" })]).error).toBe(REFETCH_FAILED_MESSAGE);
    expect(evaluateSourceOutcome([], [snap({ fetchStatus: "paused", status: "pending" })]).error).toBe(
      REFETCH_INCOMPLETE_MESSAGE,
    );
  });

  it("propagates a thrown refetch error", () => {
    expect(evaluateSourceOutcome([], [snap()], new Error("boom"))).toEqual({ ok: false, error: "boom" });
  });

  it("ignores unrelated disabled historical queries when an eligible one refreshed", () => {
    const after = [snap({ hash: "old", disabled: true, dataUpdateCount: 1 }), snap({ hash: "live", dataUpdateCount: 3 })];
    const before = [snap({ hash: "old", disabled: true, dataUpdateCount: 1 }), snap({ hash: "live", dataUpdateCount: 2 })];
    expect(evaluateSourceOutcome(before, after)).toEqual({ ok: true });
  });
});

/** The same rules against a real QueryClient, exercising real refetch behaviour. */
describe("real QueryClient refetch", () => {
  const observe = (qc: QueryClient, key: readonly unknown[]): QuerySnapshot[] =>
    qc
      .getQueryCache()
      .findAll({ queryKey: key })
      .map((q) => ({
        hash: q.queryHash,
        status: q.state.status as QuerySnapshot["status"],
        fetchStatus: q.state.fetchStatus as QuerySnapshot["fetchStatus"],
        dataUpdateCount: q.state.dataUpdateCount,
        disabled: q.getObserversCount() === 0 || q.isDisabled(),
      }));

  const run = async (qc: QueryClient, key: readonly unknown[]) => {
    const before = observe(qc, key);
    let thrown: unknown;
    try {
      await qc.refetchQueries({ queryKey: key }, { throwOnError: true });
    } catch (e) {
      thrown = e ?? new Error("failed");
    }
    return evaluateSourceOutcome(before, observe(qc, key), thrown);
  };

  it("an absent source is unavailable, not a silent success", async () => {
    const qc = new QueryClient();
    expect(await run(qc, ["cloud", "missing"])).toEqual({ ok: false, error: REFETCH_NO_QUERY_MESSAGE });
  });

  it("a failing source is reported as failed", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const key = ["cloud", "boom"];
    let fail = false;
    const options = {
      queryKey: key,
      queryFn: async () => {
        if (fail) throw new Error("network down");
        return [1];
      },
    };
    await qc.fetchQuery(options);
    const unsub = qc.getQueryCache().find({ queryKey: key })!;
    void unsub;
    fail = true;
    const outcome = await run(qc, key);
    expect(outcome.ok).toBe(false);
  });

  it("a real successful refetch passes", async () => {
    const qc = new QueryClient();
    const key = ["cloud", "kpi_values"];
    let calls = 0;
    const queryFn = async () => ++calls;
    await qc.fetchQuery({ queryKey: key, queryFn });
    // Keep an active observer so the query is eligible, like a mounted screen.
    const observer = new QueryObserver(qc, { queryKey: key, queryFn, staleTime: Infinity });
    const unsubscribe = observer.subscribe(() => {});
    const outcome = await run(qc, key);
    unsubscribe();
    expect(outcome).toEqual({ ok: true });
    expect(calls).toBe(2);
  });
});
