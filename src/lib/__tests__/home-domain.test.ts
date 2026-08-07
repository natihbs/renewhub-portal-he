import { describe, expect, it } from "vitest";

import {
  activeCompetitions,
  competitionStandings,
  daysUntil,
  lastImportLabel,
  recentFeedback,
  sessionsToDo,
  splitByPace,
  standingFor,
  summariseFreshness,
  summariseTasks,
  PACE_BUCKET_LABEL,
  type CompetitionLike,
  type PaceInput,
  type SessionLike,
  type TaskLike,
} from "@/lib/home-domain";
import { competitionLeaderboard } from "@/lib/store";
import { computeFreshness } from "@/lib/dashboard-domain";
import { paceStatus } from "@/lib/performance-domain";

// ---------------------------------------------------------------------------
// splitByPace
// ---------------------------------------------------------------------------

const rep = (repId: string, currentResult: number, target: number | null): PaceInput => ({
  repId,
  repName: `נציג ${repId}`,
  currentResult,
  target,
});

describe("splitByPace", () => {
  it("places representatives in the same bucket paceStatus would", () => {
    const inputs = [rep("a", 120, 100), rep("b", 50, 100), rep("c", 10, 100)];
    const split = splitByPace(inputs, 20, 10);
    for (const row of [...split.above, ...split.onpace, ...split.attention]) {
      expect(row.bucket).toBe(paceStatus(row.currentResult, row.target as number, 20, 10));
    }
  });

  it("keeps representatives without a target out of the pace denominator", () => {
    const split = splitByPace([rep("a", 120, 100), rep("b", 0, null), rep("c", 5, 0)], 20, 10);
    expect(split.total).toBe(3);
    expect(split.measured).toBe(1);
    expect(split.noTarget.map((r) => r.repId).sort()).toEqual(["b", "c"]);
    // The critical negative: nobody without a target may appear as "behind".
    expect(split.attention).toHaveLength(0);
  });

  it("reports a null achievement for an untargeted representative rather than 0%", () => {
    const split = splitByPace([rep("b", 40, null)], 20, 10);
    expect(split.noTarget[0].achievementPct).toBeNull();
    expect(split.noTarget[0].bucket).toBe("no_target");
  });

  it("treats a zero target as no target, not as an instantly-met one", () => {
    const split = splitByPace([rep("z", 0, 0)], 20, 10);
    expect(split.above).toHaveLength(0);
    expect(split.noTarget).toHaveLength(1);
  });

  it("orders each list by how it will be read: best first above, worst first behind", () => {
    const split = splitByPace(
      [rep("a", 200, 100), rep("b", 150, 100), rep("c", 20, 100), rep("d", 5, 100)],
      20,
      10,
    );
    expect(split.above.map((r) => r.repId)).toEqual(["a", "b"]);
    expect(split.attention.map((r) => r.repId)).toEqual(["d", "c"]);
  });

  it("every representative lands in exactly one bucket", () => {
    const inputs = [rep("a", 120, 100), rep("b", 50, 100), rep("c", 51, 100), rep("d", 0, null)];
    const split = splitByPace(inputs, 20, 10);
    const all = [...split.above, ...split.onpace, ...split.attention, ...split.noTarget];
    expect(all).toHaveLength(inputs.length);
    expect(new Set(all.map((r) => r.repId)).size).toBe(inputs.length);
    expect(split.measured + split.noTarget.length).toBe(split.total);
  });

  it("has a Hebrew label for every bucket it can produce", () => {
    for (const bucket of ["above", "onpace", "attention", "no_target"] as const) {
      expect(PACE_BUCKET_LABEL[bucket]).toMatch(/[֐-׿]/);
    }
  });

  it("handles an empty population without dividing by anything", () => {
    const split = splitByPace([], 20, 10);
    expect(split).toMatchObject({ measured: 0, total: 0 });
  });
});

// ---------------------------------------------------------------------------
// Competitions
// ---------------------------------------------------------------------------

const comp = (over: Partial<CompetitionLike> = {}): CompetitionLike => ({
  id: "c1",
  name: "תחרות אוגוסט",
  startDate: "2026-08-01",
  endDate: "2026-08-31",
  active: true,
  archived: false,
  categories: [
    { id: "cat1", points: 10 },
    { id: "cat2", points: -5 },
  ],
  scores: [],
  ...over,
});

describe("activeCompetitions", () => {
  it("requires both the active flag and the date window", () => {
    const running = comp();
    const flaggedButFinished = comp({ id: "c2", endDate: "2026-07-31" });
    const flaggedButNotStarted = comp({ id: "c3", startDate: "2026-09-01" });
    const archived = comp({ id: "c4", archived: true });
    const closed = comp({ id: "c5", active: false });

    const result = activeCompetitions(
      [running, flaggedButFinished, flaggedButNotStarted, archived, closed],
      "2026-08-07",
    );
    expect(result.map((c) => c.id)).toEqual(["c1"]);
  });

  it("includes the first and last day of the window", () => {
    expect(activeCompetitions([comp()], "2026-08-01")).toHaveLength(1);
    expect(activeCompetitions([comp()], "2026-08-31")).toHaveLength(1);
    expect(activeCompetitions([comp()], "2026-09-01")).toHaveLength(0);
  });

  it("orders by which competition closes first", () => {
    const a = comp({ id: "late", endDate: "2026-08-31" });
    const b = comp({ id: "soon", endDate: "2026-08-10" });
    expect(activeCompetitions([a, b], "2026-08-07").map((c) => c.id)).toEqual(["soon", "late"]);
  });
});

describe("daysUntil", () => {
  it("counts whole days to the closing date", () => {
    expect(daysUntil("2026-08-10", "2026-08-07")).toBe(3);
    expect(daysUntil("2026-08-07", "2026-08-07")).toBe(0);
  });

  it("never returns a negative for a date already past", () => {
    expect(daysUntil("2026-08-01", "2026-08-07")).toBe(0);
  });

  it("returns null rather than NaN for an unparseable date", () => {
    expect(daysUntil("לא תאריך", "2026-08-07")).toBeNull();
  });
});

describe("competitionStandings", () => {
  it("sums points times count across categories", () => {
    const c = comp({
      scores: [
        { repId: "r1", categoryId: "cat1", count: 3 },
        { repId: "r1", categoryId: "cat2", count: 2 },
        { repId: "r2", categoryId: "cat1", count: 1 },
      ],
    });
    // r1: 3*10 + 2*(-5) = 20, r2: 1*10 = 10
    expect(competitionStandings(c)).toEqual([
      { repId: "r1", total: 20, rank: 1 },
      { repId: "r2", total: 10, rank: 2 },
    ]);
  });

  it("skips a score whose category was deleted instead of scoring it as zero", () => {
    const c = comp({
      scores: [
        { repId: "r1", categoryId: "cat1", count: 1 },
        { repId: "r2", categoryId: "deleted-category", count: 99 },
      ],
    });
    expect(competitionStandings(c).map((s) => s.repId)).toEqual(["r1"]);
  });

  it("gives tied representatives the same rank and skips the next one", () => {
    const c = comp({
      scores: [
        { repId: "r1", categoryId: "cat1", count: 3 },
        { repId: "r2", categoryId: "cat1", count: 2 },
        { repId: "r3", categoryId: "cat1", count: 2 },
        { repId: "r4", categoryId: "cat1", count: 1 },
      ],
    });
    expect(competitionStandings(c).map((s) => s.rank)).toEqual([1, 2, 2, 4]);
  });

  it("allows a negative total — a penalty category is a real outcome", () => {
    const c = comp({ scores: [{ repId: "r1", categoryId: "cat2", count: 4 }] });
    expect(competitionStandings(c)[0]).toEqual({ repId: "r1", total: -20, rank: 1 });
  });

  it("stays the single implementation behind competitionLeaderboard", () => {
    const c = comp({
      scores: [
        { repId: "r1", categoryId: "cat1", count: 3 },
        { repId: "r2", categoryId: "cat1", count: 5 },
      ],
    });
    const viaStore = competitionLeaderboard(c as never);
    expect(viaStore.map((r) => ({ repId: r.repId, total: r.total }))).toEqual(
      competitionStandings(c).map((r) => ({ repId: r.repId, total: r.total })),
    );
  });
});

describe("standingFor", () => {
  const c = comp({
    scores: [
      { repId: "r1", categoryId: "cat1", count: 3 },
      { repId: "r2", categoryId: "cat1", count: 1 },
    ],
  });

  it("reports rank out of the representatives who actually have a score", () => {
    expect(standingFor(c, "r2")).toEqual({ total: 10, rank: 2, participants: 2 });
  });

  it("returns a null rank — not last place — for someone with no recorded score", () => {
    const mine = standingFor(c, "unscored");
    expect(mine.rank).toBeNull();
    expect(mine.total).toBe(0);
    expect(mine.participants).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// recentFeedback
// ---------------------------------------------------------------------------

describe("recentFeedback", () => {
  const list = [
    { id: "b", date: "2026-08-02", published: true },
    { id: "a", date: "2026-08-05", published: true },
    { id: "c", date: "2026-08-02", published: false },
    { id: "d", date: "2026-07-30", published: true },
  ];

  it("returns the newest first and truncates to the limit", () => {
    expect(recentFeedback(list, 2).map((f) => f.id)).toEqual(["a", "b"]);
  });

  it("breaks a same-date tie deterministically", () => {
    expect(recentFeedback(list, 4).map((f) => f.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("does not mutate the caller's array", () => {
    const copy = [...list];
    recentFeedback(list, 2);
    expect(list).toEqual(copy);
  });

  it("filters nothing by visibility — that decision belongs to visibleFeedback", () => {
    expect(recentFeedback(list, 10).some((f) => !f.published)).toBe(true);
  });

  it("treats a non-positive limit as empty rather than as the whole list", () => {
    expect(recentFeedback(list, 0)).toEqual([]);
    expect(recentFeedback(list, -3)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// sessionsToDo
// ---------------------------------------------------------------------------

const session = (over: Partial<SessionLike> & { id: string }): SessionLike => ({
  repId: "r1",
  date: "2026-08-07",
  time: "10:00",
  topic: "מכירה צולבת",
  status: "planned",
  ...over,
});

describe("sessionsToDo", () => {
  const today = "2026-08-07";

  it("splits into overdue, today and upcoming", () => {
    const result = sessionsToDo(
      [
        session({ id: "late", date: "2026-08-03" }),
        session({ id: "now", date: today }),
        session({ id: "next", date: "2026-08-09" }),
      ],
      today,
    );
    expect(result.overdue.map((s) => s.id)).toEqual(["late"]);
    expect(result.today.map((s) => s.id)).toEqual(["now"]);
    expect(result.upcoming.map((s) => s.id)).toEqual(["next"]);
  });

  it("counts overdue together with today as what is owed now", () => {
    const result = sessionsToDo(
      [
        session({ id: "late1", date: "2026-08-01" }),
        session({ id: "late2", date: "2026-08-05" }),
        session({ id: "now", date: today }),
        session({ id: "next", date: "2026-08-20" }),
      ],
      today,
    );
    expect(result.dueNow).toBe(3);
  });

  it("excludes completed and cancelled sessions — they are not work", () => {
    const result = sessionsToDo(
      [
        session({ id: "done", date: "2026-08-01", status: "completed" }),
        session({ id: "gone", date: "2026-08-01", status: "cancelled" }),
      ],
      today,
    );
    expect(result.dueNow).toBe(0);
    expect(result.overdue).toEqual([]);
  });

  it("orders same-day sessions by clock time", () => {
    const result = sessionsToDo(
      [session({ id: "pm", time: "16:30" }), session({ id: "am", time: "09:15" })],
      today,
    );
    expect(result.today.map((s) => s.id)).toEqual(["am", "pm"]);
  });
});

// ---------------------------------------------------------------------------
// summariseTasks
// ---------------------------------------------------------------------------

const task = (over: Partial<TaskLike> & { id: string }): TaskLike => ({
  title: `משימה ${over.id}`,
  done: false,
  dueOn: null,
  priority: "medium",
  ...over,
});

describe("summariseTasks", () => {
  const today = "2026-08-07";

  it("orders overdue first, then by due date, then undated last", () => {
    const summary = summariseTasks(
      [
        task({ id: "undated" }),
        task({ id: "future", dueOn: "2026-08-20" }),
        task({ id: "late", dueOn: "2026-08-01" }),
        task({ id: "today", dueOn: today }),
      ],
      today,
    );
    expect(summary.open.map((t) => t.id)).toEqual(["late", "today", "future", "undated"]);
  });

  it("counts overdue, due-today and undated separately", () => {
    const summary = summariseTasks(
      [
        task({ id: "late", dueOn: "2026-08-01" }),
        task({ id: "today", dueOn: today }),
        task({ id: "undated" }),
        task({ id: "done", dueOn: "2026-08-01", done: true }),
      ],
      today,
    );
    expect(summary).toMatchObject({ overdue: 1, dueToday: 1, undated: 1, total: 4, doneCount: 1 });
  });

  it("never counts a completed task as overdue", () => {
    const summary = summariseTasks([task({ id: "d", dueOn: "2020-01-01", done: true })], today);
    expect(summary.overdue).toBe(0);
    expect(summary.open).toEqual([]);
  });

  it("keeps a denominator even when everything is finished", () => {
    const summary = summariseTasks(
      [task({ id: "a", done: true }), task({ id: "b", done: true })],
      today,
    );
    expect(summary).toMatchObject({ total: 2, doneCount: 2 });
  });

  it("breaks a same-date tie by priority", () => {
    const summary = summariseTasks(
      [
        task({ id: "low", dueOn: today, priority: "low" }),
        task({ id: "high", dueOn: today, priority: "high" }),
      ],
      today,
    );
    expect(summary.open.map((t) => t.id)).toEqual(["high", "low"]);
  });
});

// ---------------------------------------------------------------------------
// summariseFreshness
// ---------------------------------------------------------------------------

describe("summariseFreshness", () => {
  const fresh = (sourceDataDate: string | null, today: string) =>
    computeFreshness({ sourceDataDate, lastImportAt: null, lastRefreshAt: null, today });

  it("never dresses an unknown up as current", () => {
    const s = summariseFreshness(fresh(null, "2026-08-07"));
    expect(s.unknown).toBe(true);
    expect(s.ageLabel).toBeNull();
    expect(s.tone).toBe("muted");
  });

  it("says 'today' and 'yesterday' rather than a day count", () => {
    expect(summariseFreshness(fresh("2026-08-07", "2026-08-07")).ageLabel).toBe("נכון להיום");
    expect(summariseFreshness(fresh("2026-08-06", "2026-08-07")).ageLabel).toBe("נכון לאתמול");
  });

  it("counts days once the gap is bigger than that", () => {
    expect(summariseFreshness(fresh("2026-08-02", "2026-08-07")).ageLabel).toBe(
      "נכון ללפני 5 ימים",
    );
  });

  it("escalates the tone as the data ages", () => {
    expect(summariseFreshness(fresh("2026-08-07", "2026-08-07")).tone).toBe("success");
    expect(summariseFreshness(fresh("2026-07-01", "2026-08-07")).tone).toBe("danger");
  });

  it("always produces a Hebrew state label", () => {
    for (const date of [null, "2026-08-07", "2026-08-04", "2026-06-01"]) {
      expect(summariseFreshness(fresh(date, "2026-08-07")).stateLabel).toMatch(/[֐-׿]/);
    }
  });
});

describe("lastImportLabel", () => {
  it("never presents a failed import as an update", () => {
    expect(lastImportLabel("failed")).toBe("ניסיון הייבוא האחרון נכשל");
  });

  it("marks a partial import as partial", () => {
    expect(lastImportLabel("partial")).toContain("חלקית");
  });

  it("describes a clean import plainly", () => {
    expect(lastImportLabel("success")).toBe("ייבוא אחרון");
  });

  it("does not guess in either direction for an unknown status", () => {
    for (const status of [null, undefined, "", "משהו אחר"]) {
      expect(lastImportLabel(status)).toBe("ייבוא אחרון");
    }
  });
});

// ---------------------------------------------------------------------------
// Copy discipline
//
// The product rule is that no internal English product term may reach the
// screen. Every string this module hands to the UI is checked here so a future
// edit cannot quietly introduce one.
// ---------------------------------------------------------------------------

describe("visible copy", () => {
  it("contains no Latin letters in any label this module emits", () => {
    const strings = [
      ...Object.values(PACE_BUCKET_LABEL),
      ...["success", "partial", "failed", null].map(lastImportLabel),
      summariseFreshness(
        computeFreshness({
          sourceDataDate: "2026-08-02",
          lastImportAt: null,
          lastRefreshAt: null,
          today: "2026-08-07",
        }),
      ).ageLabel as string,
    ];
    for (const s of strings) {
      expect(s).not.toMatch(/[A-Za-z]/);
    }
  });
});
