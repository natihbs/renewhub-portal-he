// Home-screen domain — pure, dependency-free, unit-tested.
//
// Everything the two home screens ("המסך שלי" for a representative, "היום
// בצוות" for a team manager) derive beyond a straight field read lives here,
// for the same reason performance-domain.ts and dashboard-domain.ts exist: a
// rule that has exactly one implementation can be tested, and cannot drift
// between the screen that shows it and the screen that summarises it.
//
// Two rules are enforced throughout and are the reason several of these
// functions return a shape rather than a number:
//   * a count is never shown without the population it was counted out of, so
//     every split reports its own denominator;
//   * an unknown is never rendered as a zero. A representative with no target
//     is not "0% of target", they are `no_target`, and they are excluded from
//     the pace denominator rather than dragging it down.

import { calculateAchievement, paceStatus, type AchievementStatus } from "@/lib/performance-domain";
import {
  FRESHNESS_STATE_LABEL,
  STALE_AFTER_DAYS,
  daysBetweenIso,
  type FreshnessModel,
} from "@/lib/dashboard-domain";
import { formatDateIL, formatMonthIL } from "@/lib/format";

// ---------------------------------------------------------------------------
// Pace split — "נציגים מעל / מתחת לקצב"
// ---------------------------------------------------------------------------

export type PaceInput = {
  repId: string;
  repName: string;
  currentResult: number;
  /** The official monthly target, or null when none has been set for this rep. */
  target: number | null;
};

/**
 * The four genuinely different situations a representative can be in.
 *
 * `no_target` is deliberately its own bucket rather than being folded into
 * `attention`. Someone nobody has set a target for has not fallen behind —
 * there is nothing to be behind — and putting them on a "מתחת לקצב" list sends
 * the manager to coach the wrong problem. The right action is to set a target,
 * which is a different button.
 */
export type PaceBucket = AchievementStatus | "no_target";

export type PaceRow = PaceInput & {
  bucket: PaceBucket;
  /** Achievement against the official target, or null when there is no target. */
  achievementPct: number | null;
};

export type PaceSplit = {
  above: PaceRow[];
  onpace: PaceRow[];
  attention: PaceRow[];
  noTarget: PaceRow[];
  /** Representatives who have a target and could therefore be placed on the pace scale. */
  measured: number;
  /** Everyone considered, including those without a target. */
  total: number;
};

export const PACE_BUCKET_LABEL: Record<PaceBucket, string> = {
  above: "מעל הקצב",
  onpace: "בקצב",
  attention: "מתחת לקצב",
  no_target: "ללא יעד מוגדר",
};

/**
 * Split a population by pace against the month elapsed so far.
 *
 * Reuses paceStatus rather than re-deriving the 5% band, so the home screen
 * and the Performance page cannot disagree about who is behind.
 *
 * Within `above` the strongest is first, and within `attention` the weakest is
 * first, because the manager reads each list for a different reason: the top of
 * one is who to recognise, the top of the other is who to help today.
 */
export function splitByPace(
  inputs: PaceInput[],
  workdaysTotal: number,
  workdaysPassed: number,
): PaceSplit {
  const above: PaceRow[] = [];
  const onpace: PaceRow[] = [];
  const attention: PaceRow[] = [];
  const noTarget: PaceRow[] = [];

  for (const input of inputs) {
    if (input.target === null || input.target <= 0) {
      noTarget.push({ ...input, bucket: "no_target", achievementPct: null });
      continue;
    }
    const achievementPct = calculateAchievement(input.currentResult, input.target);
    const bucket = paceStatus(input.currentResult, input.target, workdaysTotal, workdaysPassed);
    const row: PaceRow = { ...input, bucket, achievementPct };
    if (bucket === "above") above.push(row);
    else if (bucket === "onpace") onpace.push(row);
    else attention.push(row);
  }

  const byPctDesc = (a: PaceRow, b: PaceRow) => (b.achievementPct ?? 0) - (a.achievementPct ?? 0);
  const byPctAsc = (a: PaceRow, b: PaceRow) => (a.achievementPct ?? 0) - (b.achievementPct ?? 0);
  above.sort(byPctDesc);
  onpace.sort(byPctDesc);
  attention.sort(byPctAsc);
  noTarget.sort((a, b) => a.repName.localeCompare(b.repName, "he"));

  return {
    above,
    onpace,
    attention,
    noTarget,
    measured: above.length + onpace.length + attention.length,
    total: inputs.length,
  };
}

// ---------------------------------------------------------------------------
// Competitions — "תחרויות פעילות"
// ---------------------------------------------------------------------------

export type CompetitionCategoryLike = { id: string; points: number };
export type CompetitionScoreLike = { repId: string; categoryId: string; count: number };
export type CompetitionLike = {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  active: boolean;
  archived: boolean;
  categories: CompetitionCategoryLike[];
  scores: CompetitionScoreLike[];
};

/**
 * Competitions that are genuinely running right now.
 *
 * The `active` flag alone is not enough: it records the operator's intent and
 * nobody goes back to clear it the morning a competition ends, so a home screen
 * that trusted it would keep advertising a contest that finished three weeks
 * ago. Both the flag and the date window have to agree. A competition that has
 * not started yet is also not active — it is upcoming, which is a different
 * statement, and the caller can make it from `upcomingCompetitions`.
 */
export function activeCompetitions<T extends CompetitionLike>(comps: T[], today: string): T[] {
  return comps
    .filter((c) => c.active && !c.archived && c.startDate <= today && today <= c.endDate)
    .sort((a, b) => a.endDate.localeCompare(b.endDate));
}

/** Whole days from today until a competition closes, inclusive of the closing day. */
export function daysUntil(endDate: string, today: string): number | null {
  const end = new Date(endDate).getTime();
  const now = new Date(today).getTime();
  if (!Number.isFinite(end) || !Number.isFinite(now)) return null;
  return Math.max(0, Math.round((end - now) / 86400000));
}

export type StandingRow = { repId: string; total: number; rank: number };

/**
 * Points per representative, highest first, with competition-style ranks —
 * tied scores share a rank and the next rank skips accordingly (1, 2, 2, 4).
 *
 * This is the single implementation of the scoring formula; store.tsx's
 * competitionLeaderboard delegates to it. Two copies of "points × count summed
 * over categories" is exactly the kind of duplication that lets the standings
 * on the home screen disagree with the standings on the competitions page.
 *
 * A score entry pointing at a category that no longer exists is skipped rather
 * than counted as zero points: the category was deleted, so we do not know what
 * that count was worth.
 */
export function competitionStandings(
  // Only the scoring inputs are required — the server-side standings
  // projection computes over raw category/score rows without a full
  // competition object. Every existing caller passes a CompetitionLike,
  // which satisfies this by subtyping.
  comp: Pick<CompetitionLike, "categories" | "scores">,
): StandingRow[] {
  const pointsByCategory = new Map(comp.categories.map((c) => [c.id, c.points]));
  const byRep = new Map<string, number>();
  for (const s of comp.scores) {
    const points = pointsByCategory.get(s.categoryId);
    if (points === undefined) continue;
    byRep.set(s.repId, (byRep.get(s.repId) ?? 0) + points * s.count);
  }
  const sorted = Array.from(byRep, ([repId, total]) => ({ repId, total })).sort(
    (a, b) => b.total - a.total,
  );
  let lastTotal: number | null = null;
  let lastRank = 0;
  return sorted.map((row, i) => {
    const rank = lastTotal !== null && row.total === lastTotal ? lastRank : i + 1;
    lastTotal = row.total;
    lastRank = rank;
    return { ...row, rank };
  });
}

export type MyStanding = {
  total: number;
  /** Null when this representative has no recorded score at all. */
  rank: number | null;
  /** Representatives with any recorded score — the denominator for the rank. */
  participants: number;
};

/**
 * One representative's position in a competition.
 *
 * `rank: null` means no score has been recorded for them yet, which is a
 * different fact from being last. Ranking someone last on an empty record
 * would be an accusation the data does not support.
 */
export function standingFor(comp: CompetitionLike, repId: string): MyStanding {
  const standings = competitionStandings(comp);
  const mine = standings.find((s) => s.repId === repId);
  return {
    total: mine?.total ?? 0,
    rank: mine?.rank ?? null,
    participants: standings.length,
  };
}

// ---------------------------------------------------------------------------
// Feedback — "משובים שקיבלתי" / "משובים אחרונים"
// ---------------------------------------------------------------------------

export type FeedbackLike = { id: string; date: string; published: boolean };

/**
 * The newest evaluations first.
 *
 * Callers pass an already-visibility-filtered list — visibleFeedback() in
 * store.tsx mirrors the RLS rule and is the only thing allowed to decide who
 * may see a draft. This function only orders and truncates; it must never
 * become a second place where that boundary is decided.
 */
export function recentFeedback<T extends FeedbackLike>(list: T[], limit: number): T[] {
  return [...list]
    .sort((a, b) => (a.date === b.date ? a.id.localeCompare(b.id) : b.date.localeCompare(a.date)))
    .slice(0, Math.max(0, limit));
}

// ---------------------------------------------------------------------------
// Listening sessions — "משובים שצריך לבצע"
// ---------------------------------------------------------------------------

export type SessionLike = {
  id: string;
  repId: string;
  /** YYYY-MM-DD */
  date: string;
  /** HH:MM */
  time: string;
  topic: string;
  status: "planned" | "completed" | "cancelled";
};

export type SessionsToDo<T> = {
  /** Still planned, dated before today — these were missed. */
  overdue: T[];
  /** Still planned, dated today. */
  today: T[];
  /** Still planned, dated after today. */
  upcoming: T[];
  /** overdue + today: what the manager actually owes right now. */
  dueNow: number;
};

/**
 * Split the listening calendar into what is late, what is due today and what
 * is ahead. Completed and cancelled sessions are not work; they never appear.
 *
 * Overdue is listed first and counted with today's, because a session that was
 * planned for last Tuesday and never held is the more urgent of the two — it
 * is the one that silently disappears otherwise.
 */
export function sessionsToDo<T extends SessionLike>(sessions: T[], today: string): SessionsToDo<T> {
  const planned = sessions.filter((s) => s.status === "planned");
  const byWhen = (a: T, b: T) =>
    a.date === b.date ? a.time.localeCompare(b.time) : a.date.localeCompare(b.date);
  const overdue = planned.filter((s) => s.date < today).sort(byWhen);
  const dueToday = planned.filter((s) => s.date === today).sort(byWhen);
  const upcoming = planned.filter((s) => s.date > today).sort(byWhen);
  return { overdue, today: dueToday, upcoming, dueNow: overdue.length + dueToday.length };
}

// ---------------------------------------------------------------------------
// Personal tasks — "משימות / התחייבויות פנימיות"
// ---------------------------------------------------------------------------

export type TaskLike = {
  id: string;
  title: string;
  done: boolean;
  /** YYYY-MM-DD, or null for an undated commitment. */
  dueOn: string | null;
  priority: string;
};

export type TaskSummary<T> = {
  /** Everything not done, most urgent first. */
  open: T[];
  overdue: number;
  dueToday: number;
  /** Open items with no date at all — real work, but not schedulable. */
  undated: number;
  /** Total tasks considered, done ones included, so "3 מתוך 8" has a denominator. */
  total: number;
  doneCount: number;
};

const PRIORITY_ORDER: Record<string, number> = {
  high: 0,
  גבוהה: 0,
  medium: 1,
  בינונית: 1,
  low: 2,
  נמוכה: 2,
};

/**
 * Open commitments, ordered the way they have to be acted on: overdue first,
 * then by due date, then by priority, and undated items last.
 *
 * Undated tasks sort last rather than first because an item nobody dated is not
 * evidence of urgency — but it is counted separately so it cannot quietly fall
 * off the bottom of the list forever.
 */
export function summariseTasks<T extends TaskLike>(tasks: T[], today: string): TaskSummary<T> {
  const open = tasks.filter((t) => !t.done);
  const rank = (t: T) => (t.dueOn === null ? 2 : t.dueOn < today ? 0 : 1);
  const sorted = [...open].sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return ra - rb;
    if (a.dueOn !== b.dueOn)
      return (a.dueOn ?? "9999-12-31").localeCompare(b.dueOn ?? "9999-12-31");
    const pa = PRIORITY_ORDER[a.priority] ?? 1;
    const pb = PRIORITY_ORDER[b.priority] ?? 1;
    if (pa !== pb) return pa - pb;
    return a.title.localeCompare(b.title, "he");
  });
  return {
    open: sorted,
    overdue: open.filter((t) => t.dueOn !== null && t.dueOn < today).length,
    dueToday: open.filter((t) => t.dueOn === today).length,
    undated: open.filter((t) => t.dueOn === null).length,
    total: tasks.length,
    doneCount: tasks.length - open.length,
  };
}

// ---------------------------------------------------------------------------
// Data freshness — "מצב הנתונים / עדכון אחרון"
// ---------------------------------------------------------------------------

export type FreshnessSummary = {
  /** "עדכני" / "מתיישן" / "לא עדכני" / "אין נתונים" */
  stateLabel: string;
  /** "נכון להיום" / "נכון לאתמול" / "נכון ללפני N ימים", or null when unknown. */
  ageLabel: string | null;
  tone: "success" | "warning" | "danger" | "muted";
  /**
   * True when we cannot state how current the figures are. The screen must say
   * so rather than presenting the numbers as if they were today's — the whole
   * point of showing this line is that a manager acting on stale figures
   * should know it before they act.
   */
  unknown: boolean;
};

/**
 * How to introduce the timestamp of the last import.
 *
 * import_history records failed and partial runs too, and the timestamp alone
 * cannot tell them apart from a clean one. Labelling a failed run "ייבוא אחרון"
 * would report a failure as an update and leave a manager believing fresh data
 * arrived at a moment when none did — the exact misreading this line exists to
 * prevent. An unrecognised or missing status is described neutrally rather than
 * being guessed in either direction.
 */
export function lastImportLabel(status: string | null | undefined): string {
  if (status === "failed") return "ניסיון הייבוא האחרון נכשל";
  if (status === "partial") return "ייבוא אחרון (הושלם חלקית)";
  return "ייבוא אחרון";
}

/**
 * A one-line, honest statement of how current the performance figures are.
 *
 * Built on computeFreshness so there is one definition of "stale" across the
 * morning routine, the manager home and the representative home. `unknown` is
 * never dressed up as "עדכני": if no dated measurement exists we say we do not
 * know, because a green badge over an empty database is the worst of the four
 * possible outputs.
 */
export function summariseFreshness(freshness: FreshnessModel): FreshnessSummary {
  const stateLabel = FRESHNESS_STATE_LABEL[freshness.state];
  if (freshness.state === "unknown" || freshness.ageInDays === null) {
    return { stateLabel, ageLabel: null, tone: "muted", unknown: true };
  }
  const ageLabel =
    freshness.ageInDays === 0
      ? "נכון להיום"
      : freshness.ageInDays === 1
        ? "נכון לאתמול"
        : `נכון ללפני ${freshness.ageInDays} ימים`;
  const tone =
    freshness.state === "current" ? "success" : freshness.state === "aging" ? "warning" : "danger";
  return { stateLabel, ageLabel, tone, unknown: false };
}

// ---------------------------------------------------------------------------
// Monthly import freshness — "תקופת נתונים / ייבוא אחרון"
// ---------------------------------------------------------------------------

/**
 * Three genuinely different facts about monthly imported data, which the bar
 * previously conflated into one day-counting claim:
 *   the reporting PERIOD    which calendar month the figures describe. Stored
 *                           as import_history.period ("YYYY-MM"), with
 *                           kpi_values.metric_date (always the first of the
 *                           month) as a period MARKER fallback — it is not an
 *                           update timestamp and must never be shown as one.
 *   the last IMPORT         when data actually arrived (import_history
 *                           created_at). This is the real "עודכן" moment.
 *   the freshness STATE     whether the period on screen is the current month.
 *
 * The bug this fixes: August data imported on 08.08 carries metric_date
 * 01.08, so day-counting called it seven days old — "לא עדכני" with the
 * misleading line "הנתונים עודכנו לאחרונה ב־01.08.2026" — while the numbers
 * were the current month's, imported that same day.
 */
export type MonthlyFreshnessInput = {
  /** "YYYY-MM" from import_history.period, or a "YYYY-MM-DD" period marker. */
  period: string | null;
  /** import_history.created_at — when data last actually arrived. */
  lastImportAt: string | null;
  lastImportStatus: string | null;
  /** "YYYY-MM-DD". */
  today: string;
  /** After how many days a current-period import deserves a check. */
  staleImportAfterDays?: number;
};

export type MonthlyFreshnessSummary = {
  state: "current" | "import_old" | "stale_period" | "unknown_period" | "no_import";
  /** "עדכני" / "דורש בדיקה" / "לא עדכני" / "ללא ייבוא". */
  stateLabel: string;
  /** Ordered copy lines, ready to render. */
  lines: string[];
  tone: "success" | "warning" | "danger" | "muted";
};

const MONTHLY_FRESHNESS_STATE_LABEL: Record<MonthlyFreshnessSummary["state"], string> = {
  current: "עדכני",
  import_old: "דורש בדיקה",
  stale_period: "לא עדכני",
  unknown_period: "דורש בדיקה",
  no_import: "ללא ייבוא",
};

export const NO_IMPORT_LINE = "טרם בוצע ייבוא נתונים";
export const IMPORT_DUE_LINE = "נדרש ייבוא נתונים לחודש הנוכחי";

/** "אוגוסט 2026" from either "2026-08" or "2026-08-01". */
function monthLabelOf(periodMonth: string): string {
  return formatMonthIL(`${periodMonth}-01`);
}

/**
 * The single definition of "is the data on screen current" for monthly
 * imported data. A period equal to the current month is current data no
 * matter which day of the month it is; only the IMPORT's own age can demote
 * it — and then only to "דורש בדיקה", with copy that says the period is
 * current but the import is old, never to "לא עדכני".
 */
export function summariseMonthlyFreshness(input: MonthlyFreshnessInput): MonthlyFreshnessSummary {
  const staleImportAfterDays = input.staleImportAfterDays ?? STALE_AFTER_DAYS;
  const periodMonth = input.period ? input.period.slice(0, 7) : null;
  const currentMonth = input.today.slice(0, 7);
  const importLine = input.lastImportAt
    ? `${lastImportLabel(input.lastImportStatus)}: ${formatDateIL(input.lastImportAt)}`
    : null;

  if (!periodMonth && !input.lastImportAt) {
    return {
      state: "no_import",
      stateLabel: MONTHLY_FRESHNESS_STATE_LABEL.no_import,
      lines: [NO_IMPORT_LINE],
      tone: "muted",
    };
  }

  if (!periodMonth) {
    // Data arrived but its reporting period is unknowable (e.g. a mixed-months
    // file records no single period). Say so instead of guessing a month.
    return {
      state: "unknown_period",
      stateLabel: MONTHLY_FRESHNESS_STATE_LABEL.unknown_period,
      lines: ["תקופת הנתונים אינה ידועה", ...(importLine ? [importLine] : [])],
      tone: "warning",
    };
  }

  if (periodMonth < currentMonth) {
    return {
      state: "stale_period",
      stateLabel: MONTHLY_FRESHNESS_STATE_LABEL.stale_period,
      lines: [
        `תקופת נתונים אחרונה: ${monthLabelOf(periodMonth)}`,
        IMPORT_DUE_LINE,
        ...(importLine ? [importLine] : []),
      ],
      tone: "danger",
    };
  }

  // Current (or, defensively, future) period. The period line is stated as a
  // period — never as the date the data "was updated".
  const periodLine = `תקופת נתונים: ${monthLabelOf(periodMonth)}`;
  const importAgeInDays = input.lastImportAt
    ? daysBetweenIso(input.lastImportAt.slice(0, 10), input.today)
    : null;
  if (importAgeInDays !== null && importAgeInDays > staleImportAfterDays) {
    return {
      state: "import_old",
      stateLabel: MONTHLY_FRESHNESS_STATE_LABEL.import_old,
      lines: [periodLine, ...(importLine ? [importLine] : [])],
      tone: "warning",
    };
  }
  return {
    state: "current",
    stateLabel: MONTHLY_FRESHNESS_STATE_LABEL.current,
    lines: [periodLine, ...(importLine ? [importLine] : [NO_IMPORT_LINE])],
    tone: "success",
  };
}
