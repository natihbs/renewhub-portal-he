import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useAppMode } from "@/lib/app-mode";
import { useAuth } from "@/lib/auth";
import { getBusinessScope, type BusinessScopePayload } from "@/lib/business-scope.functions";
import { businessScopeQueryKey } from "@/lib/user-scoped-query";

/**
 * The caller's resolved business scope (see business-scope.ts for the rule
 * set). Display + client-side filtering convenience only — RLS remains the
 * authorization boundary; the same resolution feeds the database funnel.
 *
 * The cache key carries the signed-in user id: a scope resolved for one
 * account must never be read by the next account signed in to the same tab
 * (see user-scoped-query.ts).
 */
export function useBusinessScope() {
  const { isDemo } = useAppMode();
  const { user } = useAuth();
  const load = useServerFn(getBusinessScope);
  const userId = user?.id ?? null;

  const query = useQuery({
    queryKey: businessScopeQueryKey(userId),
    // Guarded so a race (sign-out mid-flight) can never associate a payload
    // with an account that is no longer signed in.
    queryFn: async () => (userId ? await load() : null),
    enabled: !isDemo && !!userId,
    staleTime: 60_000,
  });

  return {
    scope: (query.data ?? null) as BusinessScopePayload | null,
    isLoading: query.isLoading,
    isError: query.isError,
  };
}

