import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useCloudCollection } from "@/lib/cloud-hooks";

export type Notification = {
  id: string;
  kind: "performance" | "competition" | "knowledge" | "feedback";
  title: string;
  body: string;
  date: string;
  read: boolean;
  href?: string;
};

export type Activity = {
  id: string;
  kind: "performance" | "competition" | "knowledge" | "feedback" | "rep";
  text: string;
  date: string;
};

type NotificationRow = {
  id: string;
  kind: string;
  title: string;
  body: string;
  href: string | null;
  read: boolean;
  created_at: string;
};
// activity_events is retired (see 20260807091000_activity_events_lockdown.sql):
// it had a USING (true) SELECT policy readable by every representative in the
// organization, and exactly two writers — both feedback publishes — while the
// dashboard card rendered five event kinds and a badge capped by the fetch
// limit. The dashboard feed now comes from audit_log via listDashboardActivity,
// which scopes rows to the caller server-side. Nothing here reads or writes
// activity_events any more.

/** UI preference only — favorites are a per-browser convenience, not business data. */
const FAVORITES_KEY = "renewhub_favorites";
const DEFAULT_FAVORITES = ["/performance", "/feedback"];

type Ctx = {
  favorites: string[];
  notifications: Notification[];
  toggleFavorite: (path: string) => void;
  isFavorite: (path: string) => boolean;
  /**
   * §P0. Both of these were `void notifs.update(...)` — a rejected write was
   * swallowed while the bell optimistically re-rendered as read. They now
   * return promises that reject, so a caller can report the truth.
   */
  markNotificationRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
  isLoading: boolean;
  isError: boolean;
};

const UxCtx = createContext<Ctx | null>(null);

export function UxProvider({ children }: { children: ReactNode }) {
  const [favorites, setFavorites] = useState<string[]>(DEFAULT_FAVORITES);
  const [hydrated, setHydrated] = useState(false);

  const notifs = useCloudCollection<NotificationRow>("notifications", {
    order: { column: "created_at" },
    limit: 50,
  });
  useEffect(() => {
    try {
      const raw = localStorage.getItem(FAVORITES_KEY);
      if (raw) setFavorites(JSON.parse(raw));
    } catch {}
    setHydrated(true);
  }, []);
  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
    } catch {}
  }, [favorites, hydrated]);

  const value = useMemo<Ctx>(() => {
    const notifications: Notification[] = notifs.rows.map((n) => ({
      id: n.id,
      kind: n.kind as Notification["kind"],
      title: n.title,
      body: n.body,
      date: n.created_at,
      read: n.read,
      href: n.href ?? undefined,
    }));
    return {
      favorites,
      notifications,
      toggleFavorite: (path) =>
        setFavorites((f) => (f.includes(path) ? f.filter((p) => p !== path) : [...f, path])),
      isFavorite: (path) => favorites.includes(path),
      markNotificationRead: async (id) => {
        if (!notifs.live) return;
        await notifs.update(id, { read: true });
        await notifs.refetch();
      },
      // Awaited together, so "mark all read" reports success only once every
      // row has actually been written. Promise.all rather than a sequential
      // loop: these are independent single-row updates.
      markAllRead: async () => {
        if (!notifs.live) return;
        const unread = notifications.filter((x) => !x.read);
        if (unread.length === 0) return;
        await Promise.all(unread.map((n) => notifs.update(n.id, { read: true })));
        await notifs.refetch();
      },
      isLoading: notifs.isLoading,
      isError: notifs.isError,
    };
  }, [favorites, notifs]);

  return <UxCtx.Provider value={value}>{children}</UxCtx.Provider>;
}

export function useUx() {
  const ctx = useContext(UxCtx);
  if (!ctx) throw new Error("useUx outside provider");
  return ctx;
}
