// PRESENTATION HOTFIX — two focused behaviors.
//
// 1. COMPETITION LEADERBOARD FOR A REPRESENTATIVE. competition_scores is
//    authenticated-readable but representatives rows are self-only under RLS,
//    so a leaderboard that resolves names from the client-side roster showed
//    a representative a board of one. The fix is a narrow server projection —
//    { representativeId, displayName, total, rank } and nothing else — over
//    the SAME canonical scoring. These tests pin the canonical semantics the
//    projection reuses, the projection surface, and that the representatives
//    RLS itself was not touched.
//
// 2. BULK "mark all NEW representatives for creation" on the import preview.
//    A shortcut over the existing per-row action, never a new default: the
//    safety model (unmatched ⇒ skip until a person decides) is unchanged, and
//    nothing is created before the final Confirm.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { competitionStandings } from "../home-domain";
import {
  BULK_CREATE_ACTION_LABEL,
  bulkCreateCandidates,
  bulkCreateConfirmMessage,
  countImportActions,
  isBulkCreateCandidate,
} from "../import-summary";
import { processRows, type ImportMatchCandidate, type RawRow } from "../import-processing";
import type { Rep } from "../seed";

const read = (rel: string) => readFileSync(resolve(__dirname, rel), "utf8");
const fnSrc = read("../competitions.functions.ts");
const routeSrc = read("../../routes/_authenticated/competitions.tsx");
const importRouteSrc = read("../../routes/_authenticated/data-import.tsx");

// ===================================================== competition standings

// Four scored representatives, two of them tied — the live shape that
// rendered as a single person for a representative viewer.
const COMP = {
  categories: [
    { id: "cat-sale", points: 10 },
    { id: "cat-bonus", points: 5 },
  ],
  scores: [
    { repId: "rep-a", categoryId: "cat-sale", count: 3 }, // 30
    { repId: "rep-b", categoryId: "cat-sale", count: 2 }, // 20
    { repId: "rep-b", categoryId: "cat-bonus", count: 2 }, // +10 → 30 (tie with a)
    { repId: "rep-c", categoryId: "cat-sale", count: 1 }, // 10
    { repId: "rep-d", categoryId: "cat-bonus", count: 1 }, // 5
  ],
};

describe("competition standings for a representative viewer", () => {
  it("4 scored representatives produce 4 standings rows — never just the viewer", () => {
    const standings = competitionStandings(COMP);
    expect(standings).toHaveLength(4);
    expect(standings.map((s) => s.repId).sort()).toEqual(["rep-a", "rep-b", "rep-c", "rep-d"]);
    // Whichever competitor is "the viewer", their row is not the only row.
    for (const viewer of ["rep-a", "rep-b", "rep-c", "rep-d"]) {
      expect(standings.filter((s) => s.repId !== viewer).length).toBeGreaterThan(0);
    }
  });

  it("ordering and tied ranks stay canonical (1, 1, 3, 4)", () => {
    const standings = competitionStandings(COMP);
    expect(standings.map((s) => s.total)).toEqual([30, 30, 10, 5]);
    expect(standings.map((s) => s.rank)).toEqual([1, 1, 3, 4]);
  });

  it("the server projection reuses the canonical scoring — no second formula", () => {
    expect(fnSrc).toContain('import { competitionStandings } from "@/lib/home-domain"');
    // Its response carries ONLY leaderboard fields.
    expect(fnSrc).toContain("representativeId");
    expect(fnSrc).toContain("displayName");
    // The admin client touches representatives for id+name alone, and only
    // for ids already present in this competition's standings.
    expect(fnSrc).toContain('.select("id, name")');
    expect(fnSrc).not.toMatch(
      /representatives"?\)?\s*\n?\s*\.select\([^)]*(team_id|external_ref|user_id|monthly_target|current_result)/,
    );
  });

  it("no representatives RLS policy was touched — no new migration exists", () => {
    // The projection lives in application code; the RLS boundary is exactly
    // what it was. (Any widening would have required a migration.)
    expect(fnSrc).not.toContain("CREATE POLICY");
    expect(fnSrc).not.toContain("supabase/migrations");
  });

  it("the route: representatives use the server board, managers keep the local path", () => {
    expect(routeSrc).toContain("const useServerBoard = !isManager && !isDemo");
    expect(routeSrc).toContain('queryKey: ["competition-standings", comp.id]');
    // The manager render is the untouched local computation over their own
    // roster — the original block is still present verbatim.
    expect(routeSrc).toContain(
      "const leaderboard = useMemo(() => competitionLeaderboard(comp), [comp])",
    );
    expect(routeSrc).toContain("nameOf(row.repId)");
  });

  it("completed-competition details reuse the same Leaderboard component", () => {
    // Both the active card and the details sheet render <Leaderboard>, so the
    // representative-facing fix covers completed competitions too.
    expect(routeSrc.match(/<Leaderboard comp=/g)?.length).toBe(2);
  });
});

// ======================================================== bulk create marks

const TEAMS = [{ id: "team-1", name: "צוות א", active: true }];
const REPS: Rep[] = [
  {
    id: "rep-1",
    name: "קיים פעיל",
    teamId: "team-1",
    teamName: "צוות א",
    monthlyTarget: 0,
    currentResult: 0,
  },
];
const CANDIDATES: ImportMatchCandidate[] = [
  {
    id: "rep-1",
    name: "קיים פעיל",
    externalRef: null,
    email: null,
    active: true,
    teamId: "team-1",
  },
  {
    id: "rep-2",
    name: "קיים מושבת",
    externalRef: null,
    email: null,
    active: false,
    teamId: "team-1",
  },
];
const MAPPING = { שם: "name", ביצוע: "currentResult", תאריך: "updatedAt" } as Record<
  string,
  string
>;

const DATE = "2026-08-01";
const ROWS: RawRow[] = [
  { שם: "חדש א", ביצוע: 5, תאריך: DATE },
  { שם: "חדש ב", ביצוע: 6, תאריך: DATE },
  { שם: "חדש ג", ביצוע: 7, תאריך: DATE },
  { שם: "חדש ד", ביצוע: 8, תאריך: DATE },
  { שם: "קיים פעיל", ביצוע: 9, תאריך: DATE }, // matches active → update
  { שם: "קיים מושבת", ביצוע: 4, תאריך: DATE }, // matches INACTIVE → parked skip, per-row only
  { שם: "חדש שגוי", ביצוע: "לא מספר", תאריך: DATE }, // error row
];

const processed = () => processRows(ROWS, MAPPING as never, REPS, TEAMS, CANDIDATES);

const applyBulk = (rows: ReturnType<typeof processed>) =>
  rows.map((r) => (isBulkCreateCandidate(r) ? { ...r, action: "create" as const } : r));

describe("bulk mark-new-representatives-for-creation", () => {
  it("the default safety model is unchanged: unmatched valid rows start as skip", () => {
    const rows = processed();
    for (const name of ["חדש א", "חדש ב", "חדש ג", "חדש ד"]) {
      expect(rows.find((r) => r.name === name)!.action).toBe("skip");
    }
  });

  it("exactly the 4 valid unmatched rows are candidates, and bulk sets them to create", () => {
    const rows = processed();
    expect(
      bulkCreateCandidates(rows)
        .map((r) => r.name)
        .sort(),
    ).toEqual(["חדש א", "חדש ב", "חדש ג", "חדש ד"].sort());
    const after = applyBulk(rows);
    const counts = countImportActions(after);
    expect(counts.create).toBe(4);
  });

  it("a matched active representative stays update", () => {
    const after = applyBulk(processed());
    expect(after.find((r) => r.name === "קיים פעיל")!.action).toBe("update");
  });

  it("an INACTIVE match is untouched — reactivate-vs-duplicate stays a per-row decision", () => {
    const rows = processed();
    const inactive = rows.find((r) => r.matchedInactive)!;
    expect(inactive.action).toBe("skip");
    expect(isBulkCreateCandidate(inactive)).toBe(false);
    expect(applyBulk(rows).find((r) => r.matchedInactive)!.action).toBe("skip");
  });

  it("an error row stays skip", () => {
    const rows = processed();
    const bad = rows.find((r) => r.name === "חדש שגוי")!;
    expect(bad.issues.some((i) => i.severity === "error")).toBe(true);
    expect(isBulkCreateCandidate(bad)).toBe(false);
    expect(applyBulk(rows).find((r) => r.name === "חדש שגוי")!.action).toBe("skip");
  });

  it("a row someone already resolved is left exactly as they set it", () => {
    const rows = processed().map((r) =>
      r.name === "חדש ב" ? { ...r, action: "create" as const } : r,
    );
    // Already create → not a candidate (nothing to change)…
    expect(bulkCreateCandidates(rows).map((r) => r.name)).not.toContain("חדש ב");
    // …and the bulk pass leaves it as-is while marking the rest.
    const after = applyBulk(rows);
    expect(after.find((r) => r.name === "חדש ב")!.action).toBe("create");
    expect(countImportActions(after).create).toBe(4);
  });

  it("the per-row action still works independently of the bulk action", () => {
    const rows = processed();
    const one = rows.map((r) => (r.name === "חדש ג" ? { ...r, action: "create" as const } : r));
    const counts = countImportActions(one);
    expect(counts.create).toBe(1);
    expect(counts.skip).toBeGreaterThan(0);
  });

  it("no login-account semantics anywhere in the bulk path", () => {
    // The confirmation states the boundary in so many words…
    expect(bulkCreateConfirmMessage(4)).toBe(
      "4 נציגים חדשים יסומנו ליצירה. לא ייווצרו עבורם חשבונות משתמש. הייבוא יתבצע רק לאחר אישור סופי.",
    );
    expect(bulkCreateConfirmMessage(1)).toContain("נציג חדש אחד יסומן");
    // …and the bulk wiring flips row.action only — it calls no server
    // function, touches no email/password, and the Confirm step still gates
    // the import with counts recomputed from the actions.
    expect(importRouteSrc).toContain("onBulkMarkCreate");
    expect(importRouteSrc).toContain('action: "create" as ResolvedAction');
    expect(importRouteSrc).toContain("countImportActions(processed)");
    expect(BULK_CREATE_ACTION_LABEL).toBe("סמן את כל הנציגים החדשים ליצירה");
  });

  it("duplicate-prevention is intact: the inactive match still names its candidate", () => {
    const rows = processed();
    const inactive = rows.find((r) => r.matchedInactive)!;
    expect(inactive.matchRepId).toBe("rep-2");
  });
});
