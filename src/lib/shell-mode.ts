/**
 * The app shell renders either bare (auth-ish pages) or with full chrome.
 *
 * The branch used to be taken from the router pathname alone, which is not
 * hydration-stable: the server renders "/" (chrome) while the client's
 * `_authenticated` guard has already redirected to "/auth" (bare) by the time
 * hydration runs. React then reports "Hydration failed" and regenerates the
 * whole tree — the exact window in which any transient auth error becomes a
 * root error-boundary crash.
 *
 * Fix: until hydration finishes, both sides render the same neutral wrapper.
 * Nothing is lost — every authenticated route is `ssr: false`, so the server
 * never had real page content to show anyway.
 */

export const BARE_ROUTES = ["/auth", "/reset-password", "/access-denied"];

export type ShellMode = "bare" | "chrome";

export function resolveShellMode(pathname: string, hydrated: boolean): ShellMode {
  if (!hydrated) return "bare";
  return BARE_ROUTES.includes(pathname) ? "bare" : "chrome";
}
