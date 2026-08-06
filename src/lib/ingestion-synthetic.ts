// Pulse v2 — synthetic work inventory. Pure, deterministic, dependency-free.
//
// Built to be reused: the ingestion benchmarks in this PR are its first
// consumer, and Coverage and Ranking will need exactly the same book to
// benchmark against. A dataset regenerated differently between PRs makes their
// numbers incomparable, so everything here is driven by a seeded PRNG and the
// same seed always produces the same book, row for row.
//
// SHAPED LIKE A RENEWALS BOOK, not like uniform noise. Three properties of the
// real thing matter to anything that will later rank or aggregate it:
//
//   * DUE DATES CLUSTER. Policies renew on the anniversary of when they were
//     sold, and selling is seasonal, so expiries arrive in waves rather than
//     evenly. A uniform spread would make coverage-versus-capacity look
//     comfortable on every day of the year, which is the one thing it never is.
//   * VALUE IS SKEWED. A long tail of small premiums and a short head of large
//     ones. Uniform values would make value-weighted and count-weighted
//     coverage agree, hiding the whole reason for weighting.
//   * TEAMS ARE UNEVEN. Team sizes and per-representative loads vary. Equal
//     loads would make a capacity shortfall impossible to demonstrate.
//
// A generator that produced tidy uniform data would make every later benchmark
// pass and every later feature look correct on data it will never see.

// ---------------------------------------------------------------------------
// Deterministic PRNG
// ---------------------------------------------------------------------------

/**
 * mulberry32. Chosen because it is eight lines, has no dependencies, and is
 * reproducible across Node versions — the properties that matter for a
 * fixture. Statistical quality beyond "looks uneven" is irrelevant here.
 */
export function createRandom(seed: number): () => number {
  let a = seed >>> 0;
  return function random() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: () => number, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)];
}

// ---------------------------------------------------------------------------
// Org shape
// ---------------------------------------------------------------------------

export type SyntheticOrg = {
  teams: { key: string; name: string; kpiProfile: "renewals" | "generic_sales" }[];
  representatives: { externalRef: string; name: string; teamKey: string }[];
};

/**
 * Team sizes deliberately vary. An org where every team has the same headcount
 * cannot demonstrate a capacity shortfall, which is the first thing anything
 * built on this inventory will need to show.
 */
export function generateOrg(teamCount: number, seed = 20260809): SyntheticOrg {
  const rng = createRandom(seed);
  const teams: SyntheticOrg["teams"] = [];
  const representatives: SyntheticOrg["representatives"] = [];

  for (let t = 0; t < teamCount; t++) {
    const key = `synthetic-team-${String(t + 1).padStart(3, "0")}`;
    teams.push({
      key,
      name: `צוות סינתטי ${t + 1}`,
      kpiProfile: t % 3 === 0 ? "generic_sales" : "renewals",
    });

    // 6–14 people, the realistic span for a team manager.
    const size = 6 + Math.floor(rng() * 9);
    for (let r = 0; r < size; r++) {
      representatives.push({
        externalRef: `${key}-rep-${String(r + 1).padStart(2, "0")}`,
        name: `נציג ${t + 1}-${r + 1}`,
        teamKey: key,
      });
    }
  }

  return { teams, representatives };
}

// ---------------------------------------------------------------------------
// Work items
// ---------------------------------------------------------------------------

export type SyntheticRow = {
  externalRef: string;
  subjectRef: string;
  subjectLabel: string;
  ownerExternalRef: string;
  dueAtRaw: string;
  eligibleFromRaw: string;
  businessValueRaw: string;
};

export type GenerateOptions = {
  count: number;
  org: SyntheticOrg;
  /** ISO date the book is anchored on; due dates spread forward from here. */
  anchorDate: string;
  seed?: number;
  /** Offset applied to external refs so two datasets can coexist. */
  refPrefix?: string;
};

const DAY_MS = 86_400_000;

/**
 * A skewed premium: many small, few large. Roughly log-normal in shape,
 * produced by squaring a uniform, which is enough to make value-weighted and
 * count-weighted aggregates diverge — the property that matters.
 */
function skewedValue(rng: () => number): number {
  const base = rng();
  const value = 350 + base * base * 24_000;
  return Math.round(value * 100) / 100;
}

/**
 * Due dates cluster in waves rather than spreading evenly, because policies
 * renew on their sale anniversary and selling is seasonal. Modelled as four
 * peaks over the year with noise around each.
 */
function clusteredDueOffsetDays(rng: () => number): number {
  const peaks = [12, 47, 96, 158, 219, 275, 331];
  const peak = pick(rng, peaks);
  const spread = (rng() + rng() + rng() - 1.5) * 18; // roughly normal
  return Math.max(0, Math.round(peak + spread));
}

export function generateWorkItems(options: GenerateOptions): SyntheticRow[] {
  const { count, org, anchorDate } = options;
  const rng = createRandom(options.seed ?? 20260809);
  const prefix = options.refPrefix ?? "POL";
  const anchor = new Date(`${anchorDate}T00:00:00.000Z`).getTime();
  const reps = org.representatives;

  const rows: SyntheticRow[] = new Array(count);

  for (let i = 0; i < count; i++) {
    // Owner picked with a bias so some representatives carry heavier books
    // than others. A flat distribution would make every per-owner figure
    // identical and every ranking benchmark meaningless.
    const biased = Math.floor(Math.pow(rng(), 1.4) * reps.length);
    const owner = reps[Math.min(biased, reps.length - 1)];

    const dueOffset = clusteredDueOffsetDays(rng);
    const dueAt = anchor + dueOffset * DAY_MS;
    // The window opens 30–60 days before expiry, which is when a renewals
    // operation can actually start working an item.
    const eligibleFrom = dueAt - (30 + Math.floor(rng() * 31)) * DAY_MS;

    rows[i] = {
      externalRef: `${prefix}-${String(i + 1).padStart(7, "0")}`,
      subjectRef: `CUST-${String(1_000_000 + Math.floor(rng() * 4_000_000))}`,
      subjectLabel: `לקוח ${i + 1}`,
      ownerExternalRef: owner.externalRef,
      dueAtRaw: new Date(dueAt).toISOString(),
      eligibleFromRaw: new Date(eligibleFrom).toISOString(),
      businessValueRaw: skewedValue(rng).toFixed(2),
    };
  }

  return rows;
}

// ---------------------------------------------------------------------------
// Update batches
// ---------------------------------------------------------------------------

export type UpdateBatchOptions = {
  /** Share of carried-over rows whose value, owner or due date moves. 0–1. */
  churnRate: number;
  /** Share of the previous book that disappears — renewed, lapsed, withdrawn. 0–1. */
  dropRate: number;
  /** New items appearing in this delivery, as a share of the previous book. 0–1. */
  addRate: number;
  seed?: number;
  anchorDate: string;
  org: SyntheticOrg;
  refPrefix?: string;
};

export type UpdateBatchResult = {
  rows: SyntheticRow[];
  expected: { carried: number; changed: number; dropped: number; added: number };
};

/**
 * Whether two rows differ in a field the pipeline would treat as a change.
 * Mirrors the four columns ingestion_publish_batch compares, plus the owner
 * reference it resolves into one of them.
 */
function differs(a: SyntheticRow, b: SyntheticRow): boolean {
  return (
    a.ownerExternalRef !== b.ownerExternalRef ||
    a.businessValueRaw !== b.businessValueRaw ||
    a.dueAtRaw !== b.dueAtRaw ||
    a.eligibleFromRaw !== b.eligibleFromRaw
  );
}

/**
 * The next day's delivery, given yesterday's.
 *
 * The realistic shape for a daily snapshot of a renewals book: the great
 * majority of rows are byte-identical to yesterday, a small share moved, a
 * small share left the book, and a small share is new. That distribution is
 * the point — a benchmark run against a batch where everything changed would
 * measure a workload the pipeline never actually sees, and would hide the fact
 * that the expensive path is comparing 100,000 rows to find the 300 that moved.
 *
 * Returns the expected counts alongside the rows so a test can assert the
 * pipeline's own tally against an independently derived one, rather than
 * against whatever the pipeline reported.
 */
export function generateUpdateBatch(
  previous: readonly SyntheticRow[],
  options: UpdateBatchOptions,
): UpdateBatchResult {
  const rng = createRandom(options.seed ?? 20260810);
  const anchor = new Date(`${options.anchorDate}T00:00:00.000Z`).getTime();
  const reps = options.org.representatives;
  const prefix = options.refPrefix ?? "POL";

  const rows: SyntheticRow[] = [];
  let changed = 0;
  let dropped = 0;

  for (const row of previous) {
    if (rng() < options.dropRate) {
      dropped++;
      continue;
    }

    if (rng() < options.churnRate) {
      // One of three things moves, never all three: in a real book a
      // reallocation, a repricing and a date correction are separate events.
      const which = Math.floor(rng() * 3);
      let candidate: SyntheticRow;
      if (which === 0) {
        candidate = { ...row, ownerExternalRef: pick(rng, reps).externalRef };
      } else if (which === 1) {
        candidate = { ...row, businessValueRaw: skewedValue(rng).toFixed(2) };
      } else {
        const shifted = new Date(row.dueAtRaw).getTime() + (1 + Math.floor(rng() * 14)) * DAY_MS;
        candidate = { ...row, dueAtRaw: new Date(shifted).toISOString() };
      }

      // A mutation can land on the value the row already held — reassigning an
      // item to the representative who already owns it, most often. Counting
      // that as a change would inflate `expected.changed` above the number of
      // rows that actually differ, and since the whole point of returning
      // these counts is for a test to check the PIPELINE's tally against an
      // independent one, an inflated expectation would make a correct pipeline
      // look wrong. So the count follows what actually changed.
      if (differs(row, candidate)) {
        changed++;
        rows.push(candidate);
      } else {
        rows.push(row);
      }
    } else {
      rows.push(row);
    }
  }

  const carried = rows.length;
  const addCount = Math.round(previous.length * options.addRate);

  for (let i = 0; i < addCount; i++) {
    const biased = Math.floor(Math.pow(rng(), 1.4) * reps.length);
    const owner = reps[Math.min(biased, reps.length - 1)];
    const dueAt = anchor + clusteredDueOffsetDays(rng) * DAY_MS;
    const eligibleFrom = dueAt - (30 + Math.floor(rng() * 31)) * DAY_MS;

    rows.push({
      // Suffixed rather than continuing the sequence, so a new item can never
      // collide with an existing key however many update batches are chained.
      externalRef: `${prefix}-NEW-${options.seed ?? 0}-${String(i + 1).padStart(6, "0")}`,
      subjectRef: `CUST-${String(1_000_000 + Math.floor(rng() * 4_000_000))}`,
      subjectLabel: `לקוח חדש ${i + 1}`,
      ownerExternalRef: owner.externalRef,
      dueAtRaw: new Date(dueAt).toISOString(),
      eligibleFromRaw: new Date(eligibleFrom).toISOString(),
      businessValueRaw: skewedValue(rng).toFixed(2),
    });
  }

  return { rows, expected: { carried, changed, dropped, added: addCount } };
}

// ---------------------------------------------------------------------------
// Deliberately broken rows
// ---------------------------------------------------------------------------

export type CorruptionKind =
  | "missing_external_ref"
  | "malformed_due_at"
  | "malformed_business_value"
  | "negative_business_value"
  | "unknown_owner"
  | "window_inverted"
  | "duplicate_key";

/**
 * Injects a specific defect into a copy of the book, so a test can assert that
 * the pipeline rejects for the RIGHT reason rather than merely rejecting.
 *
 * A validation suite that only checks "the batch failed" passes just as
 * happily when the pipeline is broken in some entirely different way.
 */
export function injectCorruption(
  rows: readonly SyntheticRow[],
  kind: CorruptionKind,
  count = 1,
  seed = 7,
): SyntheticRow[] {
  const rng = createRandom(seed);
  const out = rows.map((r) => ({ ...r }));
  const n = Math.min(count, out.length);

  for (let i = 0; i < n; i++) {
    const idx = Math.floor(rng() * out.length);
    const row = out[idx];
    switch (kind) {
      case "missing_external_ref":
        row.externalRef = "";
        break;
      case "malformed_due_at":
        row.dueAtRaw = "31/09/2026";
        break;
      case "malformed_business_value":
        row.businessValueRaw = "₪4,200";
        break;
      case "negative_business_value":
        row.businessValueRaw = "-1200.00";
        break;
      case "unknown_owner":
        row.ownerExternalRef = "no-such-representative";
        break;
      case "window_inverted": {
        const due = new Date(row.dueAtRaw).getTime();
        row.eligibleFromRaw = new Date(due + 10 * DAY_MS).toISOString();
        break;
      }
      case "duplicate_key":
        // Copy another row's key onto this one, so the batch carries the same
        // external_ref twice and the publish would be non-deterministic.
        row.externalRef = out[(idx + 1) % out.length].externalRef;
        break;
    }
  }

  return out;
}
