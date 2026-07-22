import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

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

type UxState = {
  favorites: string[]; // route paths pinned
  notifications: Notification[];
  activity: Activity[];
};

const KEY = "renewhub_ux_v1";
const uid = () => Math.random().toString(36).slice(2, 10);
const today = () => new Date().toISOString();

const SEED: UxState = {
  favorites: ["/performance", "/feedback"],
  notifications: [
    { id: uid(), kind: "performance", title: "רן ביטון חצה את היעד", body: "עמידה של 108% בביצועי החודש.", date: today(), read: false, href: "/performance" },
    { id: uid(), kind: "feedback", title: "האזנה חדשה נוצרה", body: "האזנה חדשה עבור נועה כהן - ציון 87.", date: today(), read: false, href: "/feedback" },
    { id: uid(), kind: "competition", title: "עדכון תחרות", body: "מונדיאל החידושים - סבב חדש נפתח.", date: today(), read: false, href: "/competitions" },
    { id: uid(), kind: "knowledge", title: "מאמר חדש במרכז הידע", body: "פורסם: 'טיפול בהתנגדות מחיר בחידושי דירה'.", date: today(), read: true, href: "/knowledge" },
    { id: uid(), kind: "performance", title: "3 נציגים מתחת לקצב", body: "מומלץ לפתוח האזנה השבוע.", date: today(), read: true, href: "/performance" },
  ],
  activity: [
    { id: uid(), kind: "performance", text: "רן ביטון עבר את היעד החודשי.", date: today() },
    { id: uid(), kind: "feedback", text: "נוצרה האזנה חדשה עבור נועה כהן.", date: today() },
    { id: uid(), kind: "competition", text: "נוספה תחרות חדשה: מונדיאל החידושים.", date: today() },
    { id: uid(), kind: "knowledge", text: "עודכן מאמר במרכז הידע: תסריטי שיחה.", date: today() },
    { id: uid(), kind: "rep", text: "עודכן יעד חודשי לנציג מיכל אברהם.", date: today() },
    { id: uid(), kind: "feedback", text: "הוזן משוב מנהל עבור יוסי לוי.", date: today() },
  ],
};

type Ctx = UxState & {
  toggleFavorite: (path: string) => void;
  isFavorite: (path: string) => boolean;
  markNotificationRead: (id: string) => void;
  markAllRead: () => void;
  pushActivity: (a: Omit<Activity, "id" | "date">) => void;
};

const UxCtx = createContext<Ctx | null>(null);

export function UxProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<UxState>(SEED);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) setState({ ...SEED, ...JSON.parse(raw) });
    } catch {}
    setHydrated(true);
  }, []);
  useEffect(() => {
    if (!hydrated) return;
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {}
  }, [state, hydrated]);

  const value = useMemo<Ctx>(() => ({
    ...state,
    toggleFavorite: (path) => setState((s) => ({
      ...s,
      favorites: s.favorites.includes(path) ? s.favorites.filter((p) => p !== path) : [...s.favorites, path],
    })),
    isFavorite: (path) => state.favorites.includes(path),
    markNotificationRead: (id) => setState((s) => ({
      ...s, notifications: s.notifications.map((n) => n.id === id ? { ...n, read: true } : n),
    })),
    markAllRead: () => setState((s) => ({ ...s, notifications: s.notifications.map((n) => ({ ...n, read: true })) })),
    pushActivity: (a) => setState((s) => ({
      ...s, activity: [{ ...a, id: uid(), date: today() }, ...s.activity].slice(0, 30),
    })),
  }), [state]);

  return <UxCtx.Provider value={value}>{children}</UxCtx.Provider>;
}

export function useUx() {
  const ctx = useContext(UxCtx);
  if (!ctx) throw new Error("useUx outside provider");
  return ctx;
}
