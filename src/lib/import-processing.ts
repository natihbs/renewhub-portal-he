// Pure row-processing logic for the import wizard, split out of
// src/routes/_authenticated/data-import.tsx so it can be unit-tested without
// pulling in that route's xlsx/papaparse file-parsing dependencies.
import { z } from "zod";
import { normalizeName, resolveTeam, parseNumber, parseDate, RENEWAL_FIELDS, RENEWAL_FIELDS_WRONG_PROFILE_REASON, type ImportFieldKey } from "@/lib/import-store";
import { DEFAULT_KPI_PROFILE, type KpiProfile } from "@/lib/performance-domain";
import type { Rep } from "@/lib/seed";

export type RawRow = Record<string, unknown>;
export type Severity = "error" | "warning";
export type RowIssue = { severity: Severity; message: string };
export type ResolvedAction = "update" | "create" | "skip";

export type ProcessedRow = {
  index: number;
  raw: RawRow;
  name: string;
  /** Resolved against the real cloud teams list — never a car/home guess. Null = unassigned or unrecognized. */
  teamId: string | null;
  teamName: string | null;
  /** Raw text from the file, kept for display when it couldn't be resolved to a known team. */
  teamRaw: string;
  monthlyTarget: number | null;
  currentResult: number | null;
  updatedAt: string | null;
  /** Only ever non-null when the resolved team's kpi_profile is "renewals" — otherwise null even if the file had a value (see renewalFieldsSkipped). */
  renewalOpportunities: number | null;
  completedRenewals: number | null;
  /** True when the file mapped renewal fields but the resolved team doesn't support them, so they were read but will not be saved. */
  renewalFieldsSkipped: boolean;
  issues: RowIssue[];
  matchRepId: string | null;
  action: ResolvedAction;
};

/** Unifies CloudTeam (Live Mode, carries kpiProfile) and the plain {id,name} demo team shape. */
export type ResolvableTeam = { id: string; name: string; kpiProfile?: KpiProfile };

// zod schema for validation (per-row). Team is resolved separately against the
// real cloud teams list (resolveTeam) rather than a fixed car/home enum — an
// unrecognized team text is a warning, not a blocking error, since a rep can
// still be created/updated without a team assignment.
const rowSchema = z.object({
  name: z.string().trim().min(1, "שם הנציג חסר").max(80, "שם ארוך מדי"),
  // Optional: a row with no (or blank) target column still imports its
  // performance data normally (§20) — target is never a blocking
  // requirement. When present, it must still be a valid positive number.
  monthlyTarget: z.number({ message: "יעד חודשי חייב להיות מספר" }).positive("יעד חייב להיות חיובי").optional(),
  currentResult: z.number({ message: "ביצוע נוכחי חייב להיות מספר" }).min(0, "ביצוע לא יכול להיות שלילי"),
  updatedAt: z.string().min(1, "תאריך עדכון לא תקין"),
});

export function processRows(
  rows: RawRow[],
  mapping: Record<string, ImportFieldKey>,
  reps: Rep[],
  teams: ResolvableTeam[],
): ProcessedRow[] {
  // reverse mapping: field -> column
  const fieldToCol: Partial<Record<ImportFieldKey, string>> = {};
  for (const [col, field] of Object.entries(mapping)) {
    if (field !== "__skip__" && !fieldToCol[field]) fieldToCol[field] = col;
  }
  const repByNorm = new Map<string, Rep>();
  reps.forEach((r) => repByNorm.set(normalizeName(r.name), r));

  const seenNames = new Map<string, number>();
  const out: ProcessedRow[] = [];

  rows.forEach((raw, i) => {
    const issues: RowIssue[] = [];
    const rawName = fieldToCol.name ? String(raw[fieldToCol.name] ?? "").trim() : "";
    const teamRaw = fieldToCol.team ? String(raw[fieldToCol.team] ?? "").trim() : "";
    const { teamId, teamName } = resolveTeam(fieldToCol.team ? raw[fieldToCol.team] : null, teams);
    // An update never clears an existing team assignment just because this
    // file's team text didn't resolve — applyImport() only ever sends team_id
    // on update when a real one was resolved, precisely so a typo can't wipe a
    // rep's real assignment. A create has no prior assignment to protect, so an
    // unresolved team really is saved as unassigned. The warning must say
    // whichever of those is actually about to happen, not always the create case.
    if (teamRaw && !teamId) {
      const willUpdateExisting = rawName && repByNorm.has(normalizeName(rawName));
      issues.push({
        severity: "warning",
        message: willUpdateExisting
          ? `הצוות "${teamRaw}" אינו מזוהה מול צוותי הענן — שיוך הצוות הקיים של הנציג יישאר ללא שינוי`
          : `הצוות "${teamRaw}" אינו מזוהה מול צוותי הענן — הנציג יישמר ללא שיוך צוות`,
      });
    }
    const target = fieldToCol.monthlyTarget ? parseNumber(raw[fieldToCol.monthlyTarget]) : null;
    const current = fieldToCol.currentResult ? parseNumber(raw[fieldToCol.currentResult]) : null;
    const upd = fieldToCol.updatedAt ? parseDate(raw[fieldToCol.updatedAt]) : null;

    // Renewal fields are only ever persisted for a team whose kpi_profile is
    // "renewals" — resolved from the real cloud teams list, never inferred from the
    // team's name. Mapped-but-wrong-profile values are read (so the row's action
    // isn't affected) but explicitly nulled out for the write, with a visible warning
    // — never silently discarded without telling the user.
    const rawOpportunities = fieldToCol.renewalOpportunities ? parseNumber(raw[fieldToCol.renewalOpportunities]) : null;
    const rawCompleted = fieldToCol.completedRenewals ? parseNumber(raw[fieldToCol.completedRenewals]) : null;
    const teamProfile: KpiProfile = teamId ? teams.find((t) => t.id === teamId)?.kpiProfile ?? DEFAULT_KPI_PROFILE : DEFAULT_KPI_PROFILE;
    const renewalFieldsMapped = RENEWAL_FIELDS.some((f) => fieldToCol[f]);
    const renewalFieldsSkipped = renewalFieldsMapped && teamProfile !== "renewals" && (rawOpportunities != null || rawCompleted != null);
    if (renewalFieldsSkipped) {
      issues.push({ severity: "warning", message: RENEWAL_FIELDS_WRONG_PROFILE_REASON });
    }
    const renewalOpportunities = teamProfile === "renewals" ? rawOpportunities : null;
    const completedRenewals = teamProfile === "renewals" ? rawCompleted : null;

    const check = rowSchema.safeParse({
      name: rawName,
      monthlyTarget: target ?? undefined, currentResult: current ?? undefined,
      updatedAt: upd ?? undefined,
    });
    if (!check.success) {
      for (const err of check.error.issues) {
        issues.push({ severity: "error", message: err.message });
      }
    }
    // duplicate detection
    if (rawName) {
      const key = normalizeName(rawName);
      if (seenNames.has(key)) {
        issues.push({ severity: "warning", message: `כפילות – מופיע גם בשורה ${seenNames.get(key)! + 1}` });
      } else seenNames.set(key, i);
    }

    const match = rawName ? repByNorm.get(normalizeName(rawName)) : undefined;
    const hasErrors = issues.some((x) => x.severity === "error");
    out.push({
      index: i, raw, name: rawName, teamId, teamName, teamRaw, monthlyTarget: target, currentResult: current, updatedAt: upd,
      renewalOpportunities, completedRenewals, renewalFieldsSkipped,
      issues,
      matchRepId: match?.id ?? null,
      action: hasErrors ? "skip" : match ? "update" : "create",
    });
  });
  return out;
}
