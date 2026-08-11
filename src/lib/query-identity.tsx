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
      // the cache after the identity-transition purge has completed.
      void Promise.all(
        USER_SCOPED_QUERY_PREFIXES.map((prefix) =>
          qc.cancelQueries({ queryKey: [prefix] }),
        ),
      ).then(() => {
        for (const prefix of USER_SCOPED_QUERY_PREFIXES) {
          qc.removeQueries({ queryKey: [prefix] });
        }
      });
    }
    previous.current = identity;
  }, [identity, qc]);

  return <>{children}</>;
}
