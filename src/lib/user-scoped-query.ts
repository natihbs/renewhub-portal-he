// Identity safety for the React Query cache.
//
// The bug this exists to prevent: the business-scope query used the static key
// ["business-scope"] with a 60s staleTime. React Query caches per KEY, not per
// account, so signing out of a center manager and signing in as a team manager
// in the same tab re-used the previous account's resolved scope until a full
// page refresh — the header briefly announced "מנהל מוקד" for a
// "מנהל צוות". Nothing here changes how a scope is RESOLVED (that is
// resolveBusinessScope + RLS, untouched); this only decides which cache entry
// a given signed-in account is allowed to read.
//
// Two independent guarantees, both pure and tested:
//   1. the key itself carries the signed-in user id, so two accounts can never
//      collide on one cache entry;
//   2. on every account transition (sign-in, sign-out, account switch) the
//      user-scoped cache entries are removed outright, so nothing stale can be
//      rendered for the next account even for one frame.

/** Signed-out is a distinct identity, never "the same as before". */
export const ANONYMOUS_QUERY_IDENTITY = "anonymous";

export function queryIdentity(userId: string | null | undefined): string {
  return userId ?? ANONYMOUS_QUERY_IDENTITY;
}

/**
 * The business-scope cache key. Keeps "business-scope" as the first element so
 * every existing prefix invalidation (users/teams admin screens) still matches,
 * and appends the account identity so no two accounts share an entry.
 */
export function businessScopeQueryKey(userId: string | null | undefined) {
  return ["business-scope", queryIdentity(userId)] as const;
}

/**
 * Query-key prefixes whose rows are RLS-scoped to the signed-in account and
 * must therefore not survive an account transition. Deliberately a list of
 * user-dependent prefixes rather than a blanket cache clear.
 */
export const USER_SCOPED_QUERY_PREFIXES: readonly string[] = [
  "business-scope",
  "cloud",
  "representatives",
  "admin",
  "targets",
];

/**
 * True when the query cache must be purged of user-scoped entries. The first
 * observation of an identity is not a transition (nothing was cached for a
 * previous account), so a plain mount never triggers a refetch loop.
 */
export function shouldResetUserScopedCache(
  previous: string | null | undefined,
  next: string,
): boolean {
  if (previous === null || previous === undefined) return false;
  return previous !== next;
}
