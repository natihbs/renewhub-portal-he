# Pulse v2 — pipeline benchmarks

Reusable fixtures and timing harnesses. The synthetic dataset here is the same
one Coverage and Ranking should benchmark against; regenerating it differently
between PRs makes their numbers incomparable, so it is seeded and
deterministic.

## Files

| File | Purpose |
|---|---|
| `synthetic_inventory.sql` | Generates a synthetic org (teams, representatives) and installs `benchmark_stage_synthetic()`, which stages a renewals book directly into `ingestion_staging_rows`. The SQL twin of `src/lib/ingestion-synthetic.ts`. |
| `ingestion_benchmark.sql` | Times the four workloads the pipeline actually runs. |

## Running

Against a database with the PR #1 and PR #2 migrations applied:

```sh
psql -d "$DB" -v team_count=12 -f supabase/benchmarks/synthetic_inventory.sql
psql -d "$DB" -v item_count=100000 -f supabase/benchmarks/ingestion_benchmark.sql
```

Both are idempotent for the org fixture; the benchmark appends batches, so
start from a fresh database when comparing runs.

## Why the data is shaped the way it is

Uniform noise would make every later benchmark pass and every later feature
look correct on data it will never see. Three properties are modelled
deliberately:

- **Due dates cluster into waves.** Policies renew on their sale anniversary
  and selling is seasonal. A uniform spread would make coverage-versus-capacity
  look comfortable on every day of the year, which is the one thing it never is.
- **Value is skewed** — a long tail of small premiums, a short head of large
  ones. Uniform values would make value-weighted and count-weighted coverage
  agree, hiding the whole reason for weighting.
- **Ownership and team size are uneven.** Equal books per representative would
  make every per-owner figure identical and a capacity shortfall impossible to
  demonstrate.

## Results — 2026-08-09

Environment: PostgreSQL 16.13, 4 vCPU, 16 GB RAM, `shared_buffers=128MB`,
`work_mem=4MB` — stock defaults on a sandbox container, **not** tuned. Treat
these as a floor; a provisioned instance will be faster.

| Scenario | Rows | Stage | Finalize | Validate | Publish | **Total** |
|---|---:|---:|---:|---:|---:|---:|
| Initial import (empty inventory) | 100,000 | 5,638 ms | 111 ms | 5,774 ms | 5,328 ms | **16.9 s** |
| Incremental (3% repriced, 3,000 new) | 103,000 | 5,050 ms | 105 ms | 6,359 ms | 2,056 ms | **13.6 s** |
| Duplicate content (rejected) | 103,000 | 4,860 ms | 112 ms | 5,928 ms | — | **10.9 s** |
| Volume drop (rejected) | 5,000 | 198 ms | 5 ms | 271 ms | — | **0.5 s** |

Per-row: 169 µs initial, 132 µs incremental.

Correctness alongside the timings — the incremental run reported
`inserted 3,000, updated 2,985, unchanged 97,015`, which matches the mutation
the harness injected. A pipeline that was fast and wrong would look identical
in the timing column alone.

### What the numbers say

**Publish scales with change, not with size.** 5.3 s to insert 100,000 rows,
2.1 s to apply 5,985 changes among 103,000. The `IS DISTINCT FROM` guard on the
four mutable columns means an unchanged row is read and not written, which is
the common case for a daily snapshot and the reason the daily cost is roughly
half the first-load cost rather than equal to it.

**Validate is the floor, and it is bounded by I/O.** It parses and classifies
every staged row in one pass, writing all of them. Splitting that into three
passes (parse, classify, flag) read better and measured ~80% slower, because
each pass is a full table rewrite plus index maintenance; the parsing itself is
about 1.5 µs per call.

**The single largest win was a join.** Resolving `owner_external_ref` against
the roster started as a correlated subquery, which the planner ran once per
staged row — a sequential scan of the representatives table, 100,000 times,
measured at 3.2 s on its own. As a `LEFT JOIN` it is one hash build. Validate
went from ~10 s to ~5.8 s.

**Rejection is cheap relative to acceptance**, and gets cheaper the earlier the
defect is detectable. A volume drop is caught in 0.5 s because the batch is
small; a duplicate is caught after the full parse because the checksum can only
be compared once every row is staged.

### Headroom against the PRD

The PRD's operational target is a nightly import inside a maintenance window,
not an interactive one. At ~17 s for a full 100,000-row load on untuned
hardware there is roughly two orders of magnitude of headroom against a nightly
window, and the projected annual volume (~3.8 M items/year) is a scale
question for `work_items` retention rather than for the pipeline.

The number that would need attention first is **staging throughput over the
network**. These figures stage server-side via `generate_series`. The
TypeScript path in `runIngestionPipeline` inserts in chunks of 2,000 over
PostgREST, which is materially slower and is recorded as technical debt — the
production path should be a worker using `COPY`, not an HTTP payload.
