# Audit: intermittent "אירעה שגיאה בטעינת הדף" (read-only)

Scope: current main (HEAD `4277f07`, working tree clean, no edits beyond that commit). No code changed.

## 0. What the message actually is

The Hebrew text comes from `errorComponent` on the root route (`src/routes/__root.tsx`). It renders when the **TanStack Router match tree throws on the client** — i.e. a throw inside `beforeLoad`, a loader, or React render. It is NOT the SSR 500 path (`src/lib/error-page.ts` / `src/server.ts`, English "This page didn't load"). So this is a client-side crash, and the root boundary is the only boundary in the app — no route defines its own `errorComponent`, so every throw anywhere lands there.

## 1. Telemetry

- Lovable runtime-error capture: empty at audit time.
- Server function / worker logs (published + preview, last hour): empty — consistent with a client crash, not an SSR 500.
- Live preview reproduction (Playwright, authenticated admin session + unauthenticated): `/`, `/performance`, `/teams`, `/targets`, `/representatives`, `/users`, `/auth`, `/reset-password`, `/access-denied`, plus client-side navigations and a forced expired-token refresh — **the error boundary never rendered**. Expired token cleanly redirected to `/auth`.

Two real defects did reproduce; see 4 and 5. No stack for the user's actual crash exists in any accessible telemetry, so the ranking below is evidence-weighted, not a confirmed single root cause.

## 2. Is the hook-order crash fixed? Yes

`4277f07` (merge of `54b2c8a`) only moves `useBusinessScope()` above `if (!user) return null` in `UserMenu` — verified present in `src/components/layout/AppShell.tsx`. That was a genuine violation and it is correctly fixed.

I scanned every `.tsx` for hooks after an early return and manually reviewed each hit: all remaining hits are `return` statements inside callbacks (`.map`, `.filter`, comparators), not component early returns. Also checked for **variable hook counts** (`useQueries`, hooks in loops) — none exist; `useTeamGoals` / `useRepresentativeGoals` / `useCloudCollection` always call a fixed set of hooks regardless of array length. **No remaining conditional-hook violations.** The hook error the user saw earlier is not the current failure.

## 3. Findings

### BLOCKER — unguarded async throws in route guards bubble straight to the root boundary

`src/routes/_authenticated/route.tsx` `beforeLoad` and `src/lib/require-role.ts` `requireRole()` run on **every navigation** and call `supabase.auth.getUser()` plus a `profiles` / `user_roles` query with no `try/catch`.

`supabase-js` returns `{ error }` for auth errors, but **rethrows non-auth throws**. The realistic intermittent ones:
- `NavigatorLockAcquireTimeoutError` — supabase-js v2 serializes token refresh through `navigator.locks`; with a second tab open, a backgrounded tab, or a slow refresh, the lock acquire times out and **throws**. Classic "only sometimes", identical on preview and published.
- A raw `TypeError: Failed to fetch` escaping the auth fetch wrapper on a network blip.
- The `supabase` client Proxy throwing `Missing Supabase environment variable(s)` on first property access.

Any of these throws out of `beforeLoad` → router error → root `errorComponent` → exactly the Hebrew screen, intermittently, on any authenticated route. This is the single best-supported explanation for the report.

Smallest safe fix (2 files, no behavior change on the happy path): wrap both guards in `try/catch`, rethrow `isRedirect(error)` unchanged, and on any other error fall back to `redirect({ to: "/auth" })` (or return and let the client retry) instead of letting it escape.

### HIGH — a failed roles query is silently read as "no roles"

`getCurrentRoles()` ignores the query error and returns `roles: []`. `requireRole()` then throws `redirect({ to: "/access-denied" })`. So a transient network failure shows an **admin** the Hebrew access-denied page rather than a retry — a wrong and alarming state, and easy to confuse with the crash being audited.

Smallest safe fix: distinguish "query failed" from "no roles" and, on failure, do not cache and do not send the user to `/access-denied`.

### MEDIUM — reproducible hydration mismatch in `AppShell` on the SSR'd landing path

Reproduced 100% on an unauthenticated `GET /`:

```text
<AppShell>
-  <div className="min-h-dvh flex bg-background">   (server: full chrome, AppShell.tsx:653)
+  <div className="min-h-dvh bg-background">        (client: bare, AppShell.tsx:646)
```

The server renders `/` (root shell + chrome); on the client the `_authenticated` guard redirects to `/auth`, which is a `BARE_ROUTES` path, so `AppShell` branches differently during hydration. React reports `Hydration failed…` and regenerates the tree. It is recoverable on its own — but it means the very first client render of the app throws a recoverable error and re-renders the whole provider chain, which is exactly the window in which any of the section-3 throws becomes visible.

### MEDIUM — "Can't perform a React state update on a component that hasn't mounted yet"

Observed repeatedly (4x) during multi-route navigation in the preview, right after the hydration mismatch above. It signals an async state update landing on a tree that is being re-created. Not itself fatal, but it is the same instability window and worth clearing.

### LOW — `<Link to={dynamicString}>` with unvalidated paths

`src/components/NotificationBell.tsx:65` and `src/components/MorningRoutine.tsx:611` pass a stored `href` string straight into `<Link to=…>`. A value that does not match a known route makes the router throw at render → root boundary. Only reachable when the popover/widget renders such an item, so it does not explain a load-time failure, but it is a real crash vector.

### Provider-chain review (items 3 and 4 of the request) — clean

`AuthProvider`, `WorkspaceProvider`, `AppProvider`, `AppModeProvider`, `AdminViewProvider`, `CloudRepsSync`, `NotificationBell` were reviewed for render-time assumptions across `null → loaded` transitions. All storage reads sit in `useEffect`; all derived values null-guard (`scope?.teamIds ?? []`, `profile?.full_name || user.email`, `goals.rows[0]?.…`). Context hooks that `throw "… outside provider"` are all mounted unconditionally in `__root.tsx`. No render-time throw found on the auth/scope/workspace transition.

### Server functions / loaders (item 5) — mostly contained

Every cloud read goes through `useQuery` (no `useSuspenseQuery`, no `throwOnError`, no route `loader` outside the OAuth consent route), so a failed server function surfaces as `isError`, not as a boundary throw. The only router-level async code is the two guards in the BLOCKER above — which is precisely why they are the exposed surface.

## 4. Recommended order (if you approve a fix pass)

1. Guard `_authenticated/route.tsx` `beforeLoad` and `require-role.ts` with `try/catch` + `isRedirect` rethrow. (BLOCKER)
2. Separate "roles query failed" from "no roles" in `getCurrentRoles`. (HIGH)
3. Make `AppShell`'s bare/chrome branch hydration-stable. (MEDIUM)
4. Validate dynamic `href` against known routes before rendering `<Link>`. (LOW)

Steps 1 and 2 are ~20 lines total and change nothing on the success path. I would also add a temporary `console.error` with the raw error in the root `errorComponent` path so the next occurrence lands in Lovable telemetry with a real stack — right now the crash is invisible after the fact.
