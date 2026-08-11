import { useEffect, useRef, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import {
  USER_SCOPED_QUERY_PREFIXES,
  queryIdentity,
  shouldResetUserScopedCache,
} from "@/lib/user-scoped-query";

/**
 * Purges user-scoped React Query entries whenever the signed-in account
 * changes (sign-in, sign-out, account switch in the same tab). See
 * user-scoped-query.ts for the rule set. Keys are already user-scoped where it
 * matters; this is the belt-and-braces half, so a stale entry cannot be
 * rendered for the next account even for a single frame and no refresh is
 * required.
 */
export function QueryIdentityBoundary({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const identity = queryIdentity(user?.id);
  const previous = useRef<string | null>(null);

  useEffect(() => {
    if (shouldResetUserScopedCache(previous.current, identity)) {
      // Cancel first so an old account's in-flight request cannot repopulate
      // the cache after the identity-transition purge has completed. Do not
      // cancel the new account's business-scope request, which may already be
      // active by the time this effect runs.
      const previousBusinessScope = {
        predicate: (query: { queryKey: readonly unknown[] }) =>
          query.queryKey[0] === "business-scope" && query.queryKey[1] !== user?.id,
      };
      void qc.cancelQueries(previousBusinessScope).then(() => {
        qc.removeQueries(previousBusinessScope);
      });
      for (const prefix of USER_SCOPED_QUERY_PREFIXES) {
        if (prefix !== "business-scope") qc.removeQueries({ queryKey: [prefix] });
      }
    }
    previous.current = identity;
  }, [identity, qc, user?.id]);

  return <>{children}</>;
}
