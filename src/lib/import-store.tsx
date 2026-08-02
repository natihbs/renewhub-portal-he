import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { useCloudCollection } from "@/lib/cloud-hooks";
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

/**
 * Fields the import pipeline actually validates AND writes to the cloud. Every other
 * (non-skip) field key exists only so a matching column can be recognized in the
 * mapping UI — it is never persisted. Keeping these two lists explicit is what
 * prevents a field from silently being "accepted" (mappable, validated) while its
 * values are quietly discarded before the cloud write.
 */
export const PERSISTED_FIELDS: ImportFieldKey[] = ["name", "team", "monthlyTarget", "currentResult", "updatedAt"];

/** Recognized in a file's headers, but not yet backed by a column/pipeline that saves them. */
export const UNSUPPORTED_FIELDS: ImportFieldKey[] = [
  "prevMonthResult", "listeningCount", "lastListeningScore", "openTasks", "latePct", "talkTime", "upgradePct",
];

export const UNSUPPORTED_FIELD_REASON = "השדה מוצג להתאמה עתידית בלבד — הערכים בעמודה זו אינם נשמרים במערכת כיום.";

export const FIELD_LABEL: Record<ImportFieldKey, string> = {
  name: "שם הנציג",
  team: "צוות",
  monthlyTarget: "יעד חודשי",
  currentResult: "ביצוע נוכחי",
  updatedAt: "תאריך עדכון",
  prevMonthResult: "ביצוע חודש קודם (לא נשמר כרגע)",
  listeningCount: "מספר האזנות (לא נשמר כרגע)",
  lastListeningScore: "ציון האזנה אחרון (לא נשמר כרגע)",
  openTasks: "משימות פתוחות (לא נשמר כרגע)",
  latePct: "איחורים (לא נשמר כרגע)",
  talkTime: "זמן דיבור (לא נשמר כרגע)",
  upgradePct: "אחוז שדרוגים (לא נשמר כרגע)",
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

type Ctx = {
  templates: MappingTemplate[];
  history: ImportHistoryEntry[];
  saveTemplate: (name: string, mapping: Record<string, ImportFieldKey>) => void;
  removeTemplate: (id: string) => void;
  pushHistory: (entry: Omit<ImportHistoryEntry, "id" | "date">) => ImportHistoryEntry;
  clearSnapshotsExcept: (keepId: string) => void;
  removeHistory: (id: string) => void;
};

type TemplateRow = { id: string; name: string; mapping: Record<string, ImportFieldKey>; created_at: string };
type HistoryRow = {
  id: string;
  file_name: string;
  imported_by_name: string;
  rows_processed: number;
  rows_updated: number;
  rows_created: number;
  rows_skipped: number;
  warnings: number;
  errors: number;
  status: ImportHistoryEntry["status"];
  snapshot: Rep[] | null;
  error_report: ImportHistoryEntry["errorReport"] | null;
  created_at: string;
};

const ImportCtx = createContext<Ctx | null>(null);
const uid = () => Math.random().toString(36).slice(2, 10);

export function ImportProvider({ children }: { children: ReactNode }) {
  const templatesCloud = useCloudCollection<TemplateRow>("import_templates", {
    order: { column: "created_at" },
  });
  const historyCloud = useCloudCollection<HistoryRow>("import_history", {
    order: { column: "created_at" },
    limit: 50,
  });
  const [demoTemplates, setDemoTemplates] = useState<MappingTemplate[]>([]);
  const [demoHistory, setDemoHistory] = useState<ImportHistoryEntry[]>([]);

  const value = useMemo<Ctx>(() => {
    if (!templatesCloud.live) {
      return {
        templates: demoTemplates,
        history: demoHistory,
        saveTemplate: (name, mapping) =>
          setDemoTemplates((s) => [{ id: uid(), name, mapping, createdAt: new Date().toISOString() }, ...s]),
        removeTemplate: (id) => setDemoTemplates((s) => s.filter((t) => t.id !== id)),
        pushHistory: (entry) => {
          const full: ImportHistoryEntry = { ...entry, id: uid(), date: new Date().toISOString() };
          setDemoHistory((h) => [full, ...h.map((x) => ({ ...x, snapshot: undefined }))].slice(0, 50));
          return full;
        },
        clearSnapshotsExcept: (keepId) =>
          setDemoHistory((h) => h.map((x) => (x.id === keepId ? x : { ...x, snapshot: undefined }))),
        removeHistory: (id) => setDemoHistory((h) => h.filter((x) => x.id !== id)),
      };
    }

    const templates: MappingTemplate[] = templatesCloud.rows.map((t) => ({
      id: t.id,
      name: t.name,
      mapping: t.mapping ?? {},
      createdAt: t.created_at,
    }));
    const history: ImportHistoryEntry[] = historyCloud.rows.map((h) => ({
      id: h.id,
      fileName: h.file_name,
      date: h.created_at,
      importedBy: h.imported_by_name,
      rowsProcessed: h.rows_processed,
      rowsUpdated: h.rows_updated,
      rowsCreated: h.rows_created,
      rowsSkipped: h.rows_skipped,
      warnings: h.warnings,
      errors: h.errors,
      status: h.status,
      snapshot: h.snapshot ?? undefined,
      errorReport: h.error_report ?? undefined,
    }));

    return {
      templates,
      history,
      saveTemplate: (name, mapping) =>
        void templatesCloud.insert({ name, mapping } as never, "created_by"),
      removeTemplate: (id) => void templatesCloud.remove(id),
      pushHistory: (entry) => {
        void historyCloud
          .insert(
            {
              file_name: entry.fileName,
              imported_by_name: entry.importedBy,
              rows_processed: entry.rowsProcessed,
              rows_updated: entry.rowsUpdated,
              rows_created: entry.rowsCreated,
              rows_skipped: entry.rowsSkipped,
              warnings: entry.warnings,
              errors: entry.errors,
              status: entry.status,
              snapshot: (entry.snapshot ?? null) as never,
              error_report: (entry.errorReport ?? null) as never,
            },
            "imported_by",
          )
          .then(() => {
            // keep snapshots only on the most recent import
            for (const old of history.filter((h) => h.snapshot)) {
              void historyCloud.update(old.id, { snapshot: null });
            }
          });
        return { ...entry, id: uid(), date: new Date().toISOString() };
      },
      clearSnapshotsExcept: (keepId) => {
        for (const h of history) {
          if (h.id !== keepId && h.snapshot) void historyCloud.update(h.id, { snapshot: null });
        }
      },
      removeHistory: (id) => void historyCloud.remove(id),
    };
  }, [templatesCloud, historyCloud, demoTemplates, demoHistory]);

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

// Only fields that are actually persisted (PERSISTED_FIELDS) are auto-mapped. A
// column that merely looks like "listenings" or "late %" must never be silently
// auto-assigned to a field that gets validated and then discarded — the user has to
// see it's unsupported and, if they still map it, be told nothing will be saved.
const AUTO_MAP: { field: ImportFieldKey; keywords: string[] }[] = [
  { field: "name", keywords: ["שם הנציג", "שם נציג", "שם עובד", "שם", "נציג", "name", "employee"] },
  { field: "team", keywords: ["צוות", "team", "מחלקה"] },
  { field: "monthlyTarget", keywords: ["יעד חודשי", "יעד", "target"] },
  { field: "currentResult", keywords: ["ביצוע נוכחי", "ביצוע", "תוצאה", "result", "actual"] },
  { field: "updatedAt", keywords: ["תאריך עדכון", "תאריך", "date", "updated"] },
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

/**
 * Resolves a free-text "team" cell against the real cloud teams list — never
 * against a fixed car/home enum. Tries an exact normalized-name match first,
 * then falls back to a loose substring match either direction (handles export
 * formats that add a prefix/suffix like "צוות חידושי רכב" vs "חידושי רכב").
 * No match => unassigned (null), not a guess.
 */
export function resolveTeam(
  v: unknown,
  teams: { id: string; name: string }[],
): { teamId: string | null; teamName: string | null } {
  if (v == null) return { teamId: null, teamName: null };
  const raw = String(v).trim();
  if (!raw) return { teamId: null, teamName: null };
  const norm = normalizeName(raw);
  const exact = teams.find((t) => normalizeName(t.name) === norm);
  if (exact) return { teamId: exact.id, teamName: exact.name };
  const loose = teams.find((t) => {
    const tn = normalizeName(t.name);
    return tn.length > 0 && (tn.includes(norm) || norm.includes(tn));
  });
  if (loose) return { teamId: loose.id, teamName: loose.name };
  return { teamId: null, teamName: null };
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

