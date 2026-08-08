import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useAppMode } from "@/lib/app-mode";
import { useAuth } from "@/lib/auth";
import { getBusinessScope, type BusinessScopePayload } from "@/lib/business-scope.functions";

/**
 * The caller's resolved business scope (see business-scope.ts for the rule
 * set). Display + client-side filtering convenience only — RLS remains the
 * authorization boundary; the same resolution feeds the database funnel.
 */
export function useBusinessScope() {
  const { isDemo } = useAppMode();
  const { user } = useAuth();
  const load = useServerFn(getBusinessScope);

  const query = useQuery({
    queryKey: ["business-scope"] as const,
    queryFn: () => load(),
    enabled: !isDemo && !!user,
    staleTime: 60_000,
  });

  return {
    scope: (query.data ?? null) as BusinessScopePayload | null,
    isLoading: query.isLoading,
    isError: query.isError,
  };
}
