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
/**
 * "reactivate" (§P1) is the explicit resolution for a row matching a
 * DEACTIVATED representative: reactivate that existing record and update it,
 * instead of creating a duplicate person or silently writing to an inactive
 * one. It is only ever set by a human choosing it in the wizard — the
 * processor never assigns it automatically.
 */
export type ResolvedAction = "update" | "create" | "skip" | "reactivate";

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
  /**
   * True when the best match is a DEACTIVATED representative. Such a row is
   * never auto-resolved to "create" — that is precisely how the previous
   * implementation produced duplicate active representatives — and never
   * auto-resolved to "update" either, since silently writing new operational
   * numbers to an inactive record is the thing the inactive-rep policy
   * forbids. It is parked on "skip" until a human chooses explicitly.
   */
  matchedInactive: boolean;
  /** How the match was found, so the UI can explain itself honestly. */
  matchedBy: "external_ref" | "email" | "name" | null;
  action: ResolvedAction;
};

/**
 * The authoritative match candidate set for an import (§P1).
 *
 * The old matcher matched against `state.reps`, which is the ACTIVE-only
 * mirror maintained by CloudRepsSync. A file row naming a deactivated
 * representative therefore found no candidate at all, fell through to
 * "create", and produced a second, active representative with the same name,
 * a fresh id, zeroed history, and no relationship to the original — silently
 * fragmenting that person's identity across two records.
 *
 * This set deliberately includes inactive representatives, and carries
 * external_ref so a stable business identifier can win over name matching.
 */
export type ImportMatchCandidate = {
  id: string;
  name: string;
  externalRef: string | null;
  /** Login-account email of a linked representative (profiles.email), for
   * email-based matching. Null for unlinked representatives. */
  email: string | null;
  active: boolean;
  teamId: string | null;
};

export type ImportMatch = {
  candidate: ImportMatchCandidate;
  matchedBy: "external_ref" | "email" | "name";
} | null;

/**
 * Match one file row to a representative, in the order the sprint spec
 * requires: a stable external_ref beats everything, then an exact normalized
 * name, then nothing. Exported and pure so the precedence is directly tested.
 *
 * external_ref wins first because it is the only identifier that survives a
 * rename, and because it is UNIQUE where non-null at the database level (see
 * 20260806093000_representatives_external_ref_unique.sql) — so an
 * external_ref match is unambiguous by construction, whereas two people can
 * genuinely share a name.
 */
export function matchImportRow(
  rowName: string,
  rowExternalRef: string | null,
  candidates: ImportMatchCandidate[],
  rowEmail?: string | null,
): ImportMatch {
  const ref = rowExternalRef?.trim();
  if (ref) {
    const byRef = candidates.find((c) => c.externalRef && c.externalRef.trim() === ref);
    if (byRef) return { candidate: byRef, matchedBy: "external_ref" };
  }
  // Email sits between external_ref and name: unique per login account and
  // rename-proof, but only linked representatives have one.
  const email = rowEmail?.trim().toLowerCase();
  if (email) {
    const byEmail = candidates.find((c) => c.email && c.email.trim().toLowerCase() === email);
    if (byEmail) return { candidate: byEmail, matchedBy: "email" };
  }
  const name = rowName?.trim();
  if (name) {
    const norm = normalizeName(name);
    const byName = candidates.find((c) => normalizeName(c.name) === norm);
    if (byName) return { candidate: byName, matchedBy: "name" };
  }
  return null;
}

/**
 * An unmatched row is never auto-created (import hardening §B): it parks on
 * "skip" with this warning, and creating a representative from an import is
 * only ever an explicit per-row human choice in the preview.
 */
export const UNMATCHED_NO_AUTOCREATE_MESSAGE =
  'נציג לא מזוהה — לא ייווצר נציג חדש באופן אוטומטי. ניתן לבחור "יצירת נציג חדש" במפורש בשורה זו.';

/** Explains an inactive match in the row list, and in the confirmation UI. */
export const INACTIVE_MATCH_MESSAGE =
  "השורה תואמת נציג מושבת. יש לבחור במפורש: הפעלה מחדש ועדכון, דילוג, או יצירת נציג נפרד.";

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
  // `error` (not the deprecated `message` param) is Zod v4's constructor-level
  // error-customization option — see the Zod v4 compatibility note in the
  // sprint report for why this repo is on v4 (required by @tanstack/router's
  // own toolchain dependencies, not an arbitrary bump).
  monthlyTarget: z.number({ error: "יעד חודשי חייב להיות מספר" }).positive("יעד חייב להיות חיובי").optional(),
  currentResult: z.number({ error: "ביצוע נוכחי חייב להיות מספר" }).min(0, "ביצוע לא יכול להיות שלילי"),
  updatedAt: z.string().min(1, "תאריך עדכון לא תקין"),
});

export function processRows(
  rows: RawRow[],
  mapping: Record<string, ImportFieldKey>,
  reps: Rep[],
  teams: ResolvableTeam[],
  /**
   * Authoritative match set including INACTIVE representatives (§P1). When
   * omitted the matcher falls back to the active-only `reps` list, which is
   * the legacy behavior that could silently duplicate a deactivated person.
   */
  candidates?: ImportMatchCandidate[],
): ProcessedRow[] {
  // reverse mapping: field -> column
  const fieldToCol: Partial<Record<ImportFieldKey, string>> = {};
  for (const [col, field] of Object.entries(mapping)) {
    if (field !== "__skip__" && !fieldToCol[field]) fieldToCol[field] = col;
  }
  const repByNorm = new Map<string, Rep>();
  reps.forEach((r) => repByNorm.set(normalizeName(r.name), r));

  const seenNames = new Map<string, number>();
  const seenRefs = new Map<string, number>();
  const out: ProcessedRow[] = [];

  rows.forEach((raw, i) => {
    const issues: RowIssue[] = [];
    const rawName = fieldToCol.name ? String(raw[fieldToCol.name] ?? "").trim() : "";
    const rowExternalRefEarly = fieldToCol.externalRef
      ? String(raw[fieldToCol.externalRef] ?? "").trim() || null
      : null;
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
    // Renewal figures are counts — a negative one is always a file error, and
    // more completed renewals than opportunities deserves a human look.
    if (
      (rawOpportunities != null && rawOpportunities < 0) ||
      (rawCompleted != null && rawCompleted < 0)
    ) {
      issues.push({ severity: "error", message: "ערכי חידושים אינם יכולים להיות שליליים" });
    } else if (
      renewalOpportunities != null &&
      completedRenewals != null &&
      completedRenewals > renewalOpportunities
    ) {
      issues.push({
        severity: "warning",
        message: "חידושים שבוצעו גדולים ממספר ההזדמנויות — בדקו את הנתונים",
      });
    }

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
    // duplicate detection — by normalized name, and by the stable identifier
    // when the file carries one (two rows for the same person must be seen).
    if (rawName) {
      const key = normalizeName(rawName);
      if (seenNames.has(key)) {
        issues.push({ severity: "warning", message: `כפילות – מופיע גם בשורה ${seenNames.get(key)! + 1}` });
      } else seenNames.set(key, i);
    }
    if (rowExternalRefEarly) {
      if (seenRefs.has(rowExternalRefEarly)) {
        issues.push({
          severity: "warning",
          message: `כפילות מזהה נציג – מופיע גם בשורה ${seenRefs.get(rowExternalRefEarly)! + 1}`,
        });
      } else seenRefs.set(rowExternalRefEarly, i);
    }

    // §P1: match against the authoritative candidate set (active AND inactive)
    // when one was supplied, falling back to the legacy active-only list only
    // when a caller hasn't been migrated yet.
    const rowExternalRef = rowExternalRefEarly;
    const rowEmail = fieldToCol.email ? String(raw[fieldToCol.email] ?? "").trim() || null : null;
    const matched = candidates
      ? matchImportRow(rawName, rowExternalRef, candidates, rowEmail)
      : (() => {
          const legacy = rawName ? repByNorm.get(normalizeName(rawName)) : undefined;
          return legacy
            ? { candidate: { id: legacy.id, name: legacy.name, externalRef: null, email: null, active: true, teamId: legacy.teamId }, matchedBy: "name" as const }
            : null;
        })();

    const matchedInactive = !!matched && !matched.candidate.active;
    if (matchedInactive) {
      issues.push({ severity: "warning", message: INACTIVE_MATCH_MESSAGE });
    }
    // Unknown representative: surfaced, never silently created (§B). The row
    // parks on "skip"; creation is an explicit per-row choice in the preview.
    if (!matched && rawName) {
      issues.push({ severity: "warning", message: UNMATCHED_NO_AUTOCREATE_MESSAGE });
    }

    const hasErrors = issues.some((x) => x.severity === "error");
    out.push({
      index: i, raw, name: rawName, teamId, teamName, teamRaw, monthlyTarget: target, currentResult: current, updatedAt: upd,
      renewalOpportunities, completedRenewals, renewalFieldsSkipped,
      issues,
      matchRepId: matched?.candidate.id ?? null,
      matchedInactive,
      matchedBy: matched?.matchedBy ?? null,
      // An inactive match parks on "skip": never "create" (that duplicated the
      // person) and never "update" (that would write new operational numbers
      // to a deactivated record). An UNMATCHED row also parks on "skip" —
      // representatives are never auto-created from an import; creating one
      // is an explicit per-row choice. A human resolves both explicitly.
      action: hasErrors ? "skip" : matchedInactive ? "skip" : matched ? "update" : "skip",
    });
  });
  return out;
}
