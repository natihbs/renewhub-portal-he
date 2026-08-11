// Data-import mapping UX: the import serves EVERY team — generic teams use
// the core columns, renewals teams may ADDITIONALLY map the renewals columns.
// This is copy/grouping only: field keys, required fields, parsing and
// persistence categories are all byte-compatible with the previous behavior.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  CORE_FIELDS,
  FIELD_GROUPS,
  FIELD_LABEL,
  GENERIC_TEAM_RENEWALS_HINT,
  IMPORT_MODEL_HELPER_LINE,
  MATCH_ONLY_FIELDS,
  PERSISTED_FIELDS,
  RENEWAL_FIELDS,
  REQUIRED_FIELDS,
  UNSUPPORTED_FIELDS,
  type ImportFieldKey,
} from "../import-store";

const read = (rel: string) => readFileSync(resolve(__dirname, rel), "utf8");
const dataImportSrc = read("../../routes/_authenticated/data-import.tsx");
const importStoreSrc = read("../import-store.tsx");

describe("import model copy — the import is for every team", () => {
  it("states the team-per-row model, multi-team files and the scope limit", () => {
    expect(IMPORT_MODEL_HELPER_LINE).toBe(
      "הצוות נקבע לפי עמודת ״צוות״ בקובץ. ניתן לייבא כמה צוותים באותו קובץ, והייבוא מוגבל לצוותים שבהיקף הניהול שלך.",
    );
    // Shown near BOTH the upload area and the mapping step.
    expect(dataImportSrc).toContain("{IMPORT_MODEL_HELPER_LINE}</div>");
    const uploadStep = dataImportSrc.slice(
      dataImportSrc.indexOf("function UploadStep"),
      dataImportSrc.indexOf("function MappingStep"),
    );
    expect(uploadStep).toContain("IMPORT_MODEL_HELPER_LINE");
  });

  it("tells generic-team importers the renewals columns are simply not for them", () => {
    expect(GENERIC_TEAM_RENEWALS_HINT).toBe(
      "אם אתם מייבאים צוות רגיל, אין צורך למפות את עמודות החידושים.",
    );
    expect(dataImportSrc).toContain("GENERIC_TEAM_RENEWALS_HINT");
  });
});

describe("mapping grouping — core for all teams, renewals as optional add-on", () => {
  it("core fields are exactly the every-team set", () => {
    expect(CORE_FIELDS).toEqual([
      "name",
      "externalRef",
      "email",
      "team",
      "currentResult",
      "updatedAt",
    ]);
  });

  it("the groups partition ALL field keys exactly once (plus the skip option)", () => {
    const grouped = FIELD_GROUPS.flatMap((g) => g.fields);
    const allKeys = Object.keys(FIELD_LABEL) as ImportFieldKey[];
    expect(new Set(grouped).size).toBe(grouped.length);
    expect([...grouped, "__skip__"].sort()).toEqual([...allKeys].sort());
  });

  it("group labels are truthful and ordered core → target → renewals → unsupported", () => {
    expect(FIELD_GROUPS.map((g) => g.label)).toEqual([
      "שדות ליבה — לכל סוגי הצוותים",
      "יעד רשמי — דורש אישור נפרד",
      "שדות חידושים — רק לצוותי חידושים",
      "לא נתמכים כרגע",
    ]);
    expect(FIELD_GROUPS[1].fields).toEqual(["monthlyTarget"]);
    expect(FIELD_GROUPS[2].fields).toEqual(RENEWAL_FIELDS);
    expect(FIELD_GROUPS[3].fields).toEqual(UNSUPPORTED_FIELDS);
  });

  it("the mapping dropdown renders the groups (same keys, same disable rules)", () => {
    expect(dataImportSrc).toContain("{FIELD_GROUPS.map((group) => (");
    expect(dataImportSrc).toContain("<SelectLabel>{group.label}</SelectLabel>");
    // Whitespace-normalized: Phase 5 reflowed the mapping control onto its own
    // lines when the table became one surface per column. The disable RULE
    // pinned here — already-used field, or an unsupported one — is unchanged.
    expect(dataImportSrc.replace(/\s+/g, " ")).toContain(
      "disabled={ (f !== mapping[h] && usedFields.has(f)) || UNSUPPORTED_FIELDS.includes(f) }",
    );
  });
});

describe("labels — renewals fields are clearly optional and renewals-only", () => {
  it("renewals labels say אופציונלי and renewals-only", () => {
    expect(FIELD_LABEL.renewalOpportunities).toBe(
      "מיועדות חודשיות (אופציונלי — רק לצוותי חידושים)",
    );
    expect(FIELD_LABEL.completedRenewals).toBe("חידושים שנסגרו (אופציונלי — רק לצוותי חידושים)");
  });

  it("core wording stays neutral", () => {
    expect(FIELD_LABEL.currentResult).toBe("ביצוע נוכחי");
    expect(FIELD_LABEL.team).toBe("צוות");
    expect(FIELD_LABEL.name).toBe("שם הנציג");
    expect(FIELD_LABEL.monthlyTarget).toContain("יעד חודשי");
  });
});

describe("import behavior is unchanged — copy only", () => {
  it("required fields never include a renewals column: a generic import needs none", () => {
    expect(REQUIRED_FIELDS).toEqual(["name", "team", "currentResult", "updatedAt"]);
    for (const f of RENEWAL_FIELDS) expect(REQUIRED_FIELDS).not.toContain(f);
  });

  it("field keys and persistence categories are byte-identical to before", () => {
    expect(PERSISTED_FIELDS).toEqual([
      "name",
      "team",
      "monthlyTarget",
      "currentResult",
      "updatedAt",
    ]);
    expect(MATCH_ONLY_FIELDS).toEqual(["externalRef", "email"]);
    expect(RENEWAL_FIELDS).toEqual(["renewalOpportunities", "completedRenewals"]);
    expect(UNSUPPORTED_FIELDS).toEqual([
      "prevMonthResult",
      "listeningCount",
      "lastListeningScore",
      "openTasks",
      "latePct",
      "talkTime",
      "upgradePct",
    ]);
  });

  it("renewals fields remain available in the mapping (never removed, never required)", () => {
    const renewalGroup = FIELD_GROUPS.find((g) => g.label.includes("חידושים"))!;
    expect(renewalGroup.fields).toEqual(["renewalOpportunities", "completedRenewals"]);
  });
});

describe("column plan copy — truthful categories, not renewals-first", () => {
  it("uses the every-team / opt-in-target / renewals-only / skipped / unsupported buckets", () => {
    expect(dataImportSrc).toContain("יישמרו לכל סוגי הצוותים:");
    expect(dataImportSrc).toContain("יעד רשמי — רק אם תאשרו עדכון יעדים:");
    expect(dataImportSrc).toContain("שדות חידושים — רק לצוותי חידושים:");
    expect(dataImportSrc).toContain("ידולגו (לא נבחר שדה):");
    expect(dataImportSrc).toContain("לא נתמכים כרגע:");
  });
});

describe("template — generic columns first, renewals last and optional", () => {
  it("keeps every supported column, generic first, renewals at the end", () => {
    const start = dataImportSrc.indexOf("const headers = [");
    const slice = dataImportSrc.slice(start, dataImportSrc.indexOf("]", start));
    const order = [
      "שם הנציג",
      "מזהה נציג",
      "אימייל",
      "צוות",
      "יעד חודשי",
      "ביצוע נוכחי",
      "תאריך עדכון",
      "מיועדות חודשיות",
      "חידושים שנסגרו",
    ];
    let last = -1;
    for (const col of order) {
      const idx = slice.indexOf(`"${col}"`);
      expect(idx).toBeGreaterThan(last);
      last = idx;
    }
  });

  it("marks the renewals header cells with an optional-only note in the xlsx", () => {
    expect(dataImportSrc).toContain('t: "אופציונלי — רק לצוותי חידושים"');
    expect(dataImportSrc).toContain('for (const addr of ["H1", "I1"])');
  });
});

describe("safety — copy-only change", () => {
  it("processing, matching and write paths are untouched by this PR's surface", () => {
    // The wizard still calls the exact same pipeline entry points.
    expect(dataImportSrc).toContain("processRows(rows, mapping, state.reps, teamsForResolution");
    expect(dataImportSrc).toContain("updateRepresentativeMetrics");
    expect(dataImportSrc).toContain("writeRepresentativeKpiValue");
    expect(dataImportSrc).toContain("setRepresentativeGoals");
    expect(dataImportSrc).toContain('source: "import"');
  });

  it("no DB/RLS/role surface and no CRM vocabulary", () => {
    for (const src of [dataImportSrc, importStoreSrc]) {
      expect(src).not.toContain("ALTER ");
      expect(src).not.toContain("user_roles");
      for (const term of ["crm", "worklist", "policy_number", "call_outcome"]) {
        expect(src.toLowerCase()).not.toContain(term);
      }
    }
  });
});
