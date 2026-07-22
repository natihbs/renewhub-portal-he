import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { SEED, type AppState, type Rep, type Announcement, type Competition, type CompetitionCategory, type Article, type Feedback, type Role, type Team, CRITERIA, type CriterionValue } from "./seed";

const STORAGE_KEY = "renewhub_state_v1";

type Ctx = {
  state: AppState;
  setRole: (r: Role) => void;
  setCurrentRep: (id: string) => void;
  // reps
  addRep: (r: Omit<Rep, "id">) => void;
  updateRep: (id: string, patch: Partial<Rep>) => void;
  replaceReps: (reps: Rep[]) => void;

  removeRep: (id: string) => void;
  // announcements
  addAnnouncement: (a: Omit<Announcement, "id" | "date">) => void;
  updateAnnouncement: (id: string, patch: Partial<Announcement>) => void;
  removeAnnouncement: (id: string) => void;
  // competitions
  addCompetition: (c: Omit<Competition, "id" | "scores" | "active"> & { active?: boolean }) => void;
  updateCompetition: (id: string, patch: Partial<Competition>) => void;
  addCompetitionCategory: (compId: string, cat: Omit<CompetitionCategory, "id">) => void;
  removeCompetitionCategory: (compId: string, catId: string) => void;
  setCompetitionScore: (compId: string, repId: string, catId: string, count: number) => void;
  closeCompetition: (id: string) => void;
  // articles
  addArticle: (a: Omit<Article, "id" | "updatedAt">) => void;
  updateArticle: (id: string, patch: Partial<Article>) => void;
  removeArticle: (id: string) => void;
  // feedback
  addFeedback: (f: Omit<Feedback, "id" | "score"> & { score?: number }) => void;
  resetAll: () => void;
};

const AppCtx = createContext<Ctx | null>(null);
const uid = () => Math.random().toString(36).slice(2, 10);

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>(SEED);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setState(JSON.parse(raw));
    } catch {}
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {}
  }, [state, hydrated]);

  const patch = useCallback((p: Partial<AppState> | ((s: AppState) => AppState)) => {
    setState((s) => (typeof p === "function" ? p(s) : { ...s, ...p }));
  }, []);

  const value: Ctx = useMemo(
    () => ({
      state,
      setRole: (role) => patch({ role }),
      setCurrentRep: (currentRepId) => patch({ currentRepId }),
      addRep: (r) => patch((s) => ({ ...s, reps: [...s.reps, { ...r, id: uid() }] })),
      updateRep: (id, p) =>
        patch((s) => ({ ...s, reps: s.reps.map((r) => (r.id === id ? { ...r, ...p } : r)) })),
      replaceReps: (reps) => patch((s) => ({ ...s, reps })),

      removeRep: (id) => patch((s) => ({ ...s, reps: s.reps.filter((r) => r.id !== id) })),
      addAnnouncement: (a) =>
        patch((s) => ({
          ...s,
          announcements: [{ ...a, id: uid(), date: new Date().toISOString().slice(0, 10) }, ...s.announcements],
        })),
      updateAnnouncement: (id, p) =>
        patch((s) => ({
          ...s,
          announcements: s.announcements.map((a) => (a.id === id ? { ...a, ...p } : a)),
        })),
      removeAnnouncement: (id) =>
        patch((s) => ({ ...s, announcements: s.announcements.filter((a) => a.id !== id) })),
      addCompetition: (c) =>
        patch((s) => ({
          ...s,
          competitions: [...s.competitions, { ...c, id: uid(), scores: [], active: c.active ?? true }],
        })),
      updateCompetition: (id, p) =>
        patch((s) => ({
          ...s,
          competitions: s.competitions.map((c) => (c.id === id ? { ...c, ...p } : c)),
        })),
      addCompetitionCategory: (compId, cat) =>
        patch((s) => ({
          ...s,
          competitions: s.competitions.map((c) =>
            c.id === compId ? { ...c, categories: [...c.categories, { ...cat, id: uid() }] } : c
          ),
        })),
      removeCompetitionCategory: (compId, catId) =>
        patch((s) => ({
          ...s,
          competitions: s.competitions.map((c) =>
            c.id === compId
              ? {
                  ...c,
                  categories: c.categories.filter((k) => k.id !== catId),
                  scores: c.scores.filter((sc) => sc.categoryId !== catId),
                }
              : c
          ),
        })),
      setCompetitionScore: (compId, repId, catId, count) =>
        patch((s) => ({
          ...s,
          competitions: s.competitions.map((c) => {
            if (c.id !== compId) return c;
            const idx = c.scores.findIndex((sc) => sc.repId === repId && sc.categoryId === catId);
            const scores = [...c.scores];
            if (idx >= 0) scores[idx] = { ...scores[idx], count };
            else scores.push({ repId, categoryId: catId, count });
            return { ...c, scores };
          }),
        })),
      closeCompetition: (id) =>
        patch((s) => ({
          ...s,
          competitions: s.competitions.map((c) => (c.id === id ? { ...c, active: false } : c)),
        })),
      addArticle: (a) =>
        patch((s) => ({
          ...s,
          articles: [{ ...a, id: uid(), updatedAt: new Date().toISOString().slice(0, 10) }, ...s.articles],
        })),
      updateArticle: (id, p) =>
        patch((s) => ({
          ...s,
          articles: s.articles.map((a) =>
            a.id === id ? { ...a, ...p, updatedAt: new Date().toISOString().slice(0, 10) } : a
          ),
        })),
      removeArticle: (id) => patch((s) => ({ ...s, articles: s.articles.filter((a) => a.id !== id) })),
      addFeedback: (f) => {
        const score = f.score ?? computeScore(f.criteria);
        patch((s) => ({ ...s, feedback: [{ ...f, id: uid(), score }, ...s.feedback] }));
      },
      resetAll: () => setState(SEED),
    }),
    [state, patch]
  );

  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

export function useApp() {
  const ctx = useContext(AppCtx);
  if (!ctx) throw new Error("useApp outside provider");
  return ctx;
}

export function useIsManager() {
  return useApp().state.role === "manager";
}

// Derived helpers
export function computeScore(criteria: Record<string, CriterionValue>) {
  const values = CRITERIA.map((c) => criteria[c.key]).filter(Boolean);
  const relevant = values.filter((v) => v !== "na");
  if (relevant.length === 0) return 0;
  const sum = relevant.reduce((acc, v) => acc + (v === "done" ? 1 : v === "partial" ? 0.5 : 0), 0);
  return Math.round((sum / relevant.length) * 100);
}

export function statusForRep(rep: Rep) {
  const pct = rep.monthlyTarget > 0 ? (rep.currentResult / rep.monthlyTarget) * 100 : 0;
  if (pct >= 100) return { label: "מעל היעד", tone: "success" as const };
  if (pct >= 80) return { label: "בקצב הנדרש", tone: "warning" as const };
  return { label: "דורש שיפור", tone: "danger" as const };
}

export function teamSummary(reps: Rep[], team: Team) {
  const filtered = reps.filter((r) => r.team === team);
  const target = filtered.reduce((a, r) => a + r.monthlyTarget, 0);
  const result = filtered.reduce((a, r) => a + r.currentResult, 0);
  const pct = target > 0 ? (result / target) * 100 : 0;
  return { target, result, pct, count: filtered.length };
}

export function competitionLeaderboard(comp: Competition) {
  const byRep: Record<string, number> = {};
  for (const s of comp.scores) {
    const cat = comp.categories.find((c) => c.id === s.categoryId);
    if (!cat) continue;
    byRep[s.repId] = (byRep[s.repId] ?? 0) + cat.points * s.count;
  }
  return Object.entries(byRep)
    .map(([repId, total]) => ({ repId, total }))
    .sort((a, b) => b.total - a.total);
}
