import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Rep } from "./seed";

export type ImportFieldKey =
  | "name"
  | "team"
  | "monthlyTarget"
  | "currentResult"
  | "updatedAt"
  | "prevMonthResult"
  | "listeningCount"
  | "lastListeningScore"
  | "openTasks"
  | "latePct"
  | "talkTime"
  | "upgradePct"
  | "__skip__";

export const REQUIRED_FIELDS: ImportFieldKey[] = ["name", "team", "monthlyTarget", "currentResult", "updatedAt"];
export const FIELD_LABEL: Record<ImportFieldKey, string> = {
  name: "שם הנציג",
  team: "צוות",
  monthlyTarget: "יעד חודשי",
  currentResult: "ביצוע נוכחי",
  updatedAt: "תאריך עדכון",
  prevMonthResult: "ביצוע חודש קודם",
  listeningCount: "מספר האזנות",
  lastListeningScore: "ציון האזנה אחרון",
  openTasks: "משימות פתוחות",
  latePct: "איחורים",
  talkTime: "זמן דיבור",
  upgradePct: "אחוז שדרוגים",
  __skip__: "— התעלם —",
};

export type MappingTemplate = {
  id: string;
  name: string;
  mapping: Record<string, ImportFieldKey>; // column header -> field
  createdAt: string;
};

export type ImportHistoryEntry = {
  id: string;
  fileName: string;
  date: string;
  importedBy: string;
  rowsProcessed: number;
  rowsUpdated: number;
  rowsCreated: number;
  rowsSkipped: number;
  warnings: number;
  errors: number;
  status: "success" | "partial" | "failed";
  snapshot?: Rep[]; // previous reps for undo (only most recent kept)
  errorReport?: { row: number; name?: string; messages: string[] }[];
};

type UxState = {
  templates: MappingTemplate[];
  history: ImportHistoryEntry[];
};

const KEY = "renewhub_import_v1";
const uid = () => Math.random().toString(36).slice(2, 10);

const SEED: UxState = { templates: [], history: [] };

type Ctx = UxState & {
  saveTemplate: (name: string, mapping: Record<string, ImportFieldKey>) => void;
  removeTemplate: (id: string) => void;
  pushHistory: (entry: Omit<ImportHistoryEntry, "id" | "date">) => ImportHistoryEntry;
  clearSnapshotsExcept: (keepId: string) => void;
  removeHistory: (id: string) => void;
};

const ImportCtx = createContext<Ctx | null>(null);

export function ImportProvider({ children }: { children: ReactNode }) {
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

  const saveTemplate = useCallback((name: string, mapping: Record<string, ImportFieldKey>) => {
    setState((s) => ({
      ...s,
      templates: [{ id: uid(), name, mapping, createdAt: new Date().toISOString() }, ...s.templates].slice(0, 20),
    }));
  }, []);
  const removeTemplate = useCallback((id: string) => {
    setState((s) => ({ ...s, templates: s.templates.filter((t) => t.id !== id) }));
  }, []);
  const pushHistory = useCallback((entry: Omit<ImportHistoryEntry, "id" | "date">) => {
    const full: ImportHistoryEntry = { ...entry, id: uid(), date: new Date().toISOString() };
    setState((s) => ({
      ...s,
      // keep snapshot only on most recent
      history: [full, ...s.history.map((h) => ({ ...h, snapshot: undefined }))].slice(0, 50),
    }));
    return full;
  }, []);
  const clearSnapshotsExcept = useCallback((keepId: string) => {
    setState((s) => ({
      ...s,
      history: s.history.map((h) => (h.id === keepId ? h : { ...h, snapshot: undefined })),
    }));
  }, []);
  const removeHistory = useCallback((id: string) => {
    setState((s) => ({ ...s, history: s.history.filter((h) => h.id !== id) }));
  }, []);

  const value = useMemo<Ctx>(() => ({ ...state, saveTemplate, removeTemplate, pushHistory, clearSnapshotsExcept, removeHistory }), [state, saveTemplate, removeTemplate, pushHistory, clearSnapshotsExcept, removeHistory]);
  return <ImportCtx.Provider value={value}>{children}</ImportCtx.Provider>;
}

export function useImport() {
  const ctx = useContext(ImportCtx);
  if (!ctx) throw new Error("useImport outside provider");
  return ctx;
}

// ---------- normalization + auto-mapping ----------

export function normalizeName(name: string): string {
  const finals: Record<string, string> = { "ך": "כ", "ם": "מ", "ן": "נ", "ף": "פ", "ץ": "צ" };
  return name
    .replace(/[.,'"\-_()]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .split("")
    .map((ch) => finals[ch] ?? ch)
    .join("");
}

const AUTO_MAP: { field: ImportFieldKey; keywords: string[] }[] = [
  { field: "name", keywords: ["שם הנציג", "שם נציג", "שם עובד", "שם", "נציג", "name", "employee"] },
  { field: "team", keywords: ["צוות", "team", "מחלקה"] },
  { field: "monthlyTarget", keywords: ["יעד חודשי", "יעד", "target"] },
  { field: "currentResult", keywords: ["ביצוע נוכחי", "ביצוע", "תוצאה", "result", "actual"] },
  { field: "updatedAt", keywords: ["תאריך עדכון", "תאריך", "date", "updated"] },
  { field: "prevMonthResult", keywords: ["ביצוע חודש קודם", "חודש קודם", "prev", "previous"] },
  { field: "listeningCount", keywords: ["מספר האזנות", "האזנות", "listenings"] },
  { field: "lastListeningScore", keywords: ["ציון האזנה", "ציון", "score"] },
  { field: "openTasks", keywords: ["משימות פתוחות", "משימות", "tasks"] },
  { field: "latePct", keywords: ["איחורים", "late"] },
  { field: "talkTime", keywords: ["זמן דיבור", "talk"] },
  { field: "upgradePct", keywords: ["אחוז שדרוגים", "שדרוגים", "upgrade"] },
];

export function autoMap(headers: string[]): Record<string, ImportFieldKey> {
  const map: Record<string, ImportFieldKey> = {};
  const used = new Set<ImportFieldKey>();
  for (const h of headers) {
    const norm = h.trim().toLowerCase();
    let found: ImportFieldKey = "__skip__";
    for (const cand of AUTO_MAP) {
      if (used.has(cand.field)) continue;
      if (cand.keywords.some((k) => norm.includes(k.toLowerCase()))) {
        found = cand.field;
        break;
      }
    }
    if (found !== "__skip__") used.add(found);
    map[h] = found;
  }
  return map;
}

export function parseTeam(v: unknown): "car" | "home" | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  if (/רכב|car|auto/i.test(s)) return "car";
  if (/דירה|בית|home|house/i.test(s)) return "home";
  return null;
}

export function parseNumber(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return isFinite(v) ? v : null;
  const s = String(v).replace(/[,\s]/g, "");
  const n = Number(s);
  return isFinite(n) ? n : null;
}

export function parseDate(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) return isFinite(v.getTime()) ? v.toISOString().slice(0, 10) : null;
  if (typeof v === "number") {
    // Excel serial date
    const ms = Math.round((v - 25569) * 86400 * 1000);
    const d = new Date(ms);
    return isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : null;
  }
  const s = String(v).trim();
  // dd/mm/yyyy or dd.mm.yyyy
  const m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (m) {
    let [, dd, mm, yy] = m;
    const y = yy.length === 2 ? 2000 + Number(yy) : Number(yy);
    const d = new Date(y, Number(mm) - 1, Number(dd));
    if (isFinite(d.getTime())) return d.toISOString().slice(0, 10);
  }
  const d = new Date(s);
  return isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : null;
}

// ---------- PII detection ----------

export type PiiKind = "id" | "phone" | "email" | "policy";
export const PII_LABEL: Record<PiiKind, string> = {
  id: "תעודות זהות",
  phone: "מספרי טלפון",
  email: "כתובות אימייל",
  policy: "מספרי פוליסה",
};

export type PiiHit = {
  kind: PiiKind;
  column: string;
  sampleRow: number; // 1-indexed data row (excluding header)
  sample: string;   // truncated redacted sample
};

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
// Israeli mobile / landline: 05X-XXXXXXX, 0X-XXXXXXX, +9725X..., digit runs of 9–10 with optional separators
const PHONE_RE = /(?:\+?972[-\s]?|0)(?:[23489]|5[0-9]|7[2-9])[-\s]?\d{3}[-\s]?\d{4}/;
// 9-digit Israeli ID (also match with leading zeros); avoid matching short numbers by requiring boundary
const ID_RE = /(?<!\d)\d{9}(?!\d)/;
// Policy numbers: header-based detection (any value in a policy-labeled column) OR long numeric strings 7-12 digits with letters
const POLICY_HEADER_RE = /פוליס|policy|policyno|policy_no|policy#/i;

function redact(s: string): string {
  const t = s.length > 40 ? s.slice(0, 37) + "…" : s;
  // mask middle characters
  return t.replace(/[A-Za-z0-9]/g, (c, i) => (i < 2 || i > t.length - 3 ? c : "•"));
}

export function detectPii(headers: string[], rows: RawRowLike[]): PiiHit[] {
  const hits: PiiHit[] = [];
  const seen = new Set<string>(); // kind|column
  const maxRows = Math.min(rows.length, 500);

  const policyCols = headers.filter((h) => POLICY_HEADER_RE.test(h));

  for (let i = 0; i < maxRows; i++) {
    const row = rows[i];
    for (const col of headers) {
      const raw = row[col];
      if (raw == null || raw === "") continue;
      const val = String(raw);

      const push = (kind: PiiKind, sample: string) => {
        const key = `${kind}|${col}`;
        if (seen.has(key)) return;
        seen.add(key);
        hits.push({ kind, column: col, sampleRow: i + 1, sample: redact(sample) });
      };

      if (EMAIL_RE.test(val)) push("email", val);
      if (PHONE_RE.test(val)) push("phone", val);
      const idMatch = val.match(ID_RE);
      if (idMatch) push("id", idMatch[0]);

      if (policyCols.includes(col) && val.trim().length >= 4) {
        push("policy", val);
      }
    }
  }
  return hits;
}

type RawRowLike = Record<string, unknown>;

