/**
 * Decision logic for the `_authenticated` route gate, extracted so it can be
 * tested and — more importantly — so every failure path is explicit.
 *
 * `supabase-js` returns `{ error }` for auth errors but *rethrows* everything
 * else (NavigatorLockAcquireTimeoutError from token-refresh lock contention,
 * raw `TypeError: Failed to fetch`, the client's missing-env Proxy throw).
 * Those used to escape `beforeLoad` and land on the root error boundary as the
 * intermittent Hebrew crash page. An unresolved session now fails closed to
 * /auth instead.
 */

export type GuardProfile = { must_change_password?: boolean | null; active?: boolean | null } | null;

export type GuardDeps<U> = {
  getUser: () => Promise<{ user: U | null; error: unknown }>;
  getProfile: (userId: string) => Promise<GuardProfile>;
  signOut: () => Promise<void>;
};

export type GuardOutcome<U> =
  | { kind: "redirect"; to: "/auth" | "/reset-password" }
  | { kind: "allow"; user: U };

export async function resolveAuthenticatedGuard<U extends { id: string }>(
  deps: GuardDeps<U>,
): Promise<GuardOutcome<U>> {
  let user: U | null;
  try {
    const result = await deps.getUser();
    if (result.error || !result.user) return { kind: "redirect", to: "/auth" };
    user = result.user;
  } catch (error) {
    console.error("[Pulse] auth gate could not resolve the session", error);
    return { kind: "redirect", to: "/auth" };
  }

  let profile: GuardProfile;
  try {
    profile = await deps.getProfile(user.id);
  } catch (error) {
    console.error("[Pulse] auth gate could not load the profile", error);
    return { kind: "redirect", to: "/auth" };
  }

  if (profile?.active === false) {
    try {
      await deps.signOut();
    } catch (error) {
      console.error("[Pulse] auth gate could not sign out an inactive user", error);
    }
    return { kind: "redirect", to: "/auth" };
  }

  if (profile?.must_change_password) return { kind: "redirect", to: "/reset-password" };

  return { kind: "allow", user };
}
