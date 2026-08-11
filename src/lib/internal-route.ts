/**
 * Stored notification / morning-routine hrefs are free-form strings that were
 * persisted at some earlier point in the app's life. TanStack `<Link to={...}>`
 * throws at render time when `to` is not a known route, and the only error
 * boundary in the app is the root one — so a single stale href takes the whole
 * page down with "אירעה שגיאה בטעינת הדף".
 *
 * This resolves an arbitrary stored href into a link target that is guaranteed
 * to be renderable, or `null` so the caller can fall back to non-navigating
 * content. Presentation-only: it never changes what a notification means.
 */

/** Every path the router can actually match (see src/routes). */
export const KNOWN_ROUTES = [
  "/",
  "/admin",
  "/ai-insights",
  "/changelog",
  "/communications",
  "/competitions",
  "/data-import",
  "/feedback",
  "/knowledge",
  "/performance",
  "/representatives",
  "/targets",
  "/teams",
  "/users",
  "/auth",
  "/reset-password",
  "/access-denied",
] as const;

export type KnownRoute = (typeof KNOWN_ROUTES)[number];

export type InternalLinkTarget = { to: KnownRoute; hash?: string };

const KNOWN = new Set<string>(KNOWN_ROUTES);

function normalizePath(path: string): string {
  if (path.length > 1 && path.endsWith("/")) return path.slice(0, -1);
  return path;
}

/**
 * `null` means "not safely linkable" — render plain content instead.
 * A bare `#anchor` keeps the existing behaviour of scrolling on the home page.
 */
export function resolveInternalLink(href: string | null | undefined): InternalLinkTarget | null {
  if (typeof href !== "string") return null;
  const raw = href.trim();
  if (!raw) return null;

  // External / protocol-relative / query strings are never valid app targets.
  if (raw.includes("://") || raw.startsWith("//") || raw.includes("?")) return null;

  if (raw.startsWith("#")) {
    const hash = raw.slice(1);
    return hash ? { to: "/", hash } : null;
  }

  if (!raw.startsWith("/")) return null;

  const hashIndex = raw.indexOf("#");
  const path = normalizePath(hashIndex === -1 ? raw : raw.slice(0, hashIndex));
  const hash = hashIndex === -1 ? "" : raw.slice(hashIndex + 1);

  if (!KNOWN.has(path)) return null;
  return hash ? { to: path as KnownRoute, hash } : { to: path as KnownRoute };
}

export function isKnownInternalPath(href: string | null | undefined): boolean {
  return resolveInternalLink(href) !== null;
}
