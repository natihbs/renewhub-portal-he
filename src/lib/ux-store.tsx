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
type ActivityRow = { id: string; kind: string; text: string; created_at: string };

/** UI preference only — favorites are a per-browser convenience, not business data. */
const FAVORITES_KEY = "renewhub_favorites";
const DEFAULT_FAVORITES = ["/performance", "/feedback"];

type Ctx = {
  favorites: string[];
  notifications: Notification[];
  activity: Activity[];
  toggleFavorite: (path: string) => void;
  isFavorite: (path: string) => boolean;
  markNotificationRead: (id: string) => void;
  markAllRead: () => void;
  pushActivity: (a: Omit<Activity, "id" | "date">) => void;
};

const UxCtx = createContext<Ctx | null>(null);

export function UxProvider({ children }: { children: ReactNode }) {
  const [favorites, setFavorites] = useState<string[]>(DEFAULT_FAVORITES);
  const [hydrated, setHydrated] = useState(false);

  const notifs = useCloudCollection<NotificationRow>("notifications", {
    order: { column: "created_at" },
    limit: 50,
  });
  const activityCloud = useCloudCollection<ActivityRow>("activity_events", {
    order: { column: "created_at" },
    limit: 30,
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
    const activity: Activity[] = activityCloud.rows.map((a) => ({
      id: a.id,
      kind: a.kind as Activity["kind"],
      text: a.text,
      date: a.created_at,
    }));

    return {
      favorites,
      notifications,
      activity,
      toggleFavorite: (path) =>
        setFavorites((f) => (f.includes(path) ? f.filter((p) => p !== path) : [...f, path])),
      isFavorite: (path) => favorites.includes(path),
      markNotificationRead: (id) => {
        if (!notifs.live) return;
        void notifs.update(id, { read: true });
      },
      markAllRead: () => {
        if (!notifs.live) return;
        for (const n of notifications.filter((x) => !x.read)) void notifs.update(n.id, { read: true });
      },
      pushActivity: (a) => {
        if (!activityCloud.live) return;
        void activityCloud.insert({ kind: a.kind, text: a.text }, "actor_id");
      },
    };
  }, [favorites, notifs, activityCloud]);

  return <UxCtx.Provider value={value}>{children}</UxCtx.Provider>;
}

export function useUx() {
  const ctx = useContext(UxCtx);
  if (!ctx) throw new Error("useUx outside provider");
  return ctx;
}
