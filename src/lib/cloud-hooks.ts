import { useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useAppMode } from "@/lib/app-mode";
import { useAuth } from "@/lib/auth";
import {
  cloudList,
  cloudInsert,
  cloudUpdate,
  cloudUpsert,
  cloudDelete,
  cloudDeleteWhere,
  type Row,
} from "@/lib/cloud.functions";

type ListOpts = {
  eq?: Record<string, string | number | boolean | null>;
  /** Match a column against any value in the given list (SQL `IN`). */
  in?: Record<string, (string | number)[]>;
  order?: { column: string; ascending?: boolean };
  limit?: number;
  /** Set false to hold the query off even in Live Mode (e.g. a dependent
   * filter value hasn't resolved yet) — combined with the live check, never
   * used to override it. */
  enabled?: boolean;
};

/**
 * Cloud-backed collection. In Live Mode this is the ONLY source of truth —
 * nothing is written to localStorage. Demo Mode simply disables the query and
 * lets the calling store fall back to its in-memory demo data.
 */
export function useCloudCollection<T>(table: string, opts: ListOpts = {}) {
  const { isDemo } = useAppMode();
  const { user } = useAuth();
  const qc = useQueryClient();

  const list = useServerFn(cloudList);
  const insertFn = useServerFn(cloudInsert);
  const updateFn = useServerFn(cloudUpdate);
  const upsertFn = useServerFn(cloudUpsert);
  const deleteFn = useServerFn(cloudDelete);
  const deleteWhereFn = useServerFn(cloudDeleteWhere);

  const live = !isDemo && !!user && (opts.enabled ?? true);
  const key = useMemo(() => ["cloud", table, opts] as const, [table, opts]);

  const query = useQuery({
    queryKey: key,
    queryFn: async () => (await list({ data: { table, eq: opts.eq, in: opts.in, order: opts.order, limit: opts.limit } })) as T[],
    enabled: live,
    staleTime: 15_000,
  });

  const invalidate = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ["cloud", table] });
  }, [qc, table]);

  /**
   * Awaitable refetch of exactly this collection. `invalidate` above is
   * deliberately fire-and-forget for the common optimistic case; this is for
   * callers that must not report success until the refreshed rows have
   * actually landed (task toggle, data-freshness check).
   */
  const refetch = useCallback(
    () => qc.refetchQueries({ queryKey: ["cloud", table] }),
    [qc, table],
  );

  const insert = useCallback(
    async (values: Row, stampUser?: string) => {
      const row = (await insertFn({ data: { table, values, stampUser } })) as T;
      invalidate();
      return row;
    },
    [insertFn, table, invalidate],
  );

  const update = useCallback(
    async (id: string, values: Row, idColumn?: string) => {
      const row = (await updateFn({ data: { table, id, values, idColumn } })) as T;
      invalidate();
      return row;
    },
    [updateFn, table, invalidate],
  );

  const upsert = useCallback(
    async (values: Row, onConflict?: string, stampUser?: string) => {
      const row = (await upsertFn({ data: { table, values, onConflict, stampUser } })) as T;
      invalidate();
      return row;
    },
    [upsertFn, table, invalidate],
  );

  const remove = useCallback(
    async (id: string, idColumn?: string) => {
      await deleteFn({ data: { table, id, idColumn } });
      invalidate();
    },
    [deleteFn, table, invalidate],
  );

  const removeWhere = useCallback(
    async (eq: Record<string, string | number | boolean | null>) => {
      await deleteWhereFn({ data: { table, eq } });
      invalidate();
    },
    [deleteWhereFn, table, invalidate],
  );

  return {
    live,
    rows: (query.data ?? []) as T[],
    isLoading: live && query.isLoading,
    isError: live && query.isError,
    error: query.error as Error | null,
    insert,
    update,
    upsert,
    remove,
    removeWhere,
    refresh: invalidate,
    refetch,
  };
}
