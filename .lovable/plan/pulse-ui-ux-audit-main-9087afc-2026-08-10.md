# Pulse — UI/UX Audit (main @ 9087afc)

Audit only. No code changed, nothing committed. Boundaries respected: no DB/RLS/auth/role proposals unless explicitly flagged, and no CRM/worklist/queue/customer/policy/call-outcome concepts.

## 1. Strengths

- **Role-aware navigation is a single source of truth.** `src/lib/navigation-config.ts` drives sidebar, bottom nav and command palette, with per-role labels ("הביצועים שלי" vs "ביצועים") and documented reasoning (`navigation-config.ts:66-115`). The admin view switcher is presentation-only with a persistent banner stating permissions are unchanged (`AppShell.tsx:198-217`).
- **Scope/hierarchy is visible, not implied.** Workspace switcher collapses to a static locked label when there is only one option instead of a one-item dropdown (`AppShell.tsx:305-317`); `/data-import` names the exact teams an import can reach (`data-import.tsx:98-121`); `/targets` groups by center/activity/executive with per-team "missing targets" badges (`targets.tsx:316-354`).
- **Honest empty/loading/error states.** Nearly every surface distinguishes loading, error and empty, and `/knowledge` even splits "genuinely empty" from "no filter matches" with different CTAs (`knowledge.tsx:81-103`). `/targets` and `/teams` errors offer retry (`targets.tsx:487-498`, `teams.tsx:298-305`).
- **Copy explains *why*, not just *what*.** Month framing ("החודש הנוכחי / חודש עתידי · תכנון / חודש קודם · היסטוריה", `targets.tsx:536-541`), deactivated-team read-only banner (`targets.tsx:572-576`), delete blocked with the reason and a "deactivate instead" nudge (`teams.tsx:498-501`), import's "new reps are never auto-created" notice (`data-import.tsx:1044-1051`).
- **Real mobile work already done.** Bottom nav with 4 items + "עוד" (`AppShell.tsx:505-550`), 44px touch targets, and true desktop-table / mobile-card pairs on `/performance`, `/feedback`, `/teams`, `/targets`.
- **Safe-by-default destructive flows.** Competition delete disabled once scores exist, archive offered instead (`competitions.tsx:360-374`); import PII detection is a hard blocking dialog (`data-import.tsx:740-778`); unsaved-change badges gate saves in `/targets` (`targets.tsx:610-619`).

## 2. Ranked improvements

### P0

**P0-1 — `/users` loses key columns on mobile with no fallback**
- Problem: team, manager, created and last-login columns are `hidden md:table-cell` / `hidden lg:table-cell` (`users.tsx:326-337`) with no mobile card list. On a phone an admin sees name + status only and must open each row's drawer to learn anything.
- Behavior: mirror the `/teams` pattern — `hidden md:block` table plus a `md:hidden` card list showing name, email, role, team, manager and status, with the same row tap → details sheet.
- Files: `src/routes/_authenticated/users.tsx`.
- Risk: low. Migration: no.

**P0-2 — Import preview only shows the first 20 rows**
- Problem: `processed.slice(0, 20)` with the literal note "מוצגות 20 השורות הראשונות מתוך N" (`data-import.tsx:1021, 1068`). Errors, warnings and inactive-match decisions past row 20 are invisible before commit, so the admin approves an import they have not seen and only learns of problems from the post-hoc error report.
- Behavior: add client-side pagination (or "show all") over the already-computed `processed` array plus a filter chip row: הכול / שגיאות / אזהרות / דורש החלטה / חדשים. Default the filter to "requires decision" when any exist.
- Files: `src/routes/_authenticated/data-import.tsx` (preview step only; `import-processing.ts` untouched).
- Risk: low — pure presentation over existing in-memory data. Migration: no.

**P0-3 — Inactive-match decisions are one row at a time**
- Problem: each matched-but-deactivated row requires an individual reactivate/skip/create choice (`data-import.tsx:1016`). A re-import after a cleanup can present dozens of identical decisions with no way to answer once.
- Behavior: a header strip on the inactive-match warning — "החל על כל השורות התואמות נציגים מושבתים: הפעלה מחדש / דילוג", applying to the currently filtered rows, with per-row override preserved and a count of what was applied.
- Files: `src/routes/_authenticated/data-import.tsx`.
- Risk: medium (bulk mutation of pending decisions — must stay pre-commit and reversible before the confirm step). Migration: no.

### P1

**P1-1 — Audit log tab is unusable at scale**
- Problem: `/users` → "יומן פעולות" has no search, no date filter, no pagination, a bare "טוען..." with no error branch, and `details` rendered as truncated `JSON.stringify` (`users.tsx:379-419`).
- Behavior: add actor/action/date filters, pagination matching the users tab (25/page), a skeleton and an error+retry state, and render `details` as readable Hebrew key/value pairs with a "view raw" expander.
- Files: `src/routes/_authenticated/users.tsx` (plus the existing audit read function if a limit/offset param is already supported — otherwise page client-side first).
- Risk: low. Migration: no.

**P1-2 — Disabled actions without an explanation**
- Problem: "השבתת משתמש" and "מחיקת משתמש" are disabled for self and for the last active admin (`users.tsx:570-582`) with no tooltip. This is the one place the app breaks its own "explain why" convention (`teams.tsx:452-462` does it right).
- Behavior: wrap disabled menu items in a tooltip: "לא ניתן להשבית את המשתמש שאיתו התחברת" / "זהו מנהל המערכת הפעיל האחרון".
- Files: `src/routes/_authenticated/users.tsx`.
- Risk: low. Migration: no.

**P1-3 — Raw color leaks break dark mode and the token system**
- Problem: `bg-[#e8f0e6]` and `bg-white`/`text-emerald-700` in the WhatsApp preview (`communications.tsx:449-453`), `text-yellow-500` for the gold medal (`competitions.tsx:556`), `text-yellow-500` / `bg-yellow-500 text-white` for "important" articles (`knowledge.tsx:123, 165`).
- Behavior: add a `--chat-surface` / `--chat-bubble` token pair for the WhatsApp mock (it is a deliberate brand mock, so token it rather than force semantic colors) and route the medal/important styling through `--warning`.
- Files: `src/styles.css`, `communications.tsx`, `competitions.tsx`, `knowledge.tsx`.
- Risk: low. Migration: no.

**P1-4 — `/knowledge` has no loading state**
- Problem: articles come from `useApp()` with no `isLoading` handling in the page; on a slow first load a manager sees "מרכז הידע ריק" before data arrives — a false empty state, the exact class of bug the rest of the app guards against.
- Behavior: expose the articles loading flag on the store consumer and render a card skeleton; keep the existing dual empty-state branching for the settled case.
- Files: `src/routes/_authenticated/knowledge.tsx`, `src/lib/store.tsx` (read-only flag surface, no data-flow change).
- Risk: low. Migration: no.

**P1-5 — `/competitions` has no search or filter**
- Problem: active/completed/archived render as flat lists with no search, so historical competitions become an unnavigable scroll.
- Behavior: reuse the `/knowledge` filter card — search by name plus a status select — above the sections.
- Files: `src/routes/_authenticated/competitions.tsx`.
- Risk: low. Migration: no.

**P1-6 — Manager on `/teams` sees a read-only module labeled "הצוות שלי"**
- Problem: the nav promises ownership, but nearly every write control is admin-gated, so a manager lands on a view-only page. The per-row "צפייה בלבד" hint exists (`teams.tsx:452-462`) but the page-level framing does not set that expectation.
- Behavior: presentation-only — for managers, show a header note ("צפייה בפרטי הצוות; שינויי מבנה מתבצעים על ידי מנהל מערכת") and surface the actions a manager *can* take from here as links (targets, reps, feedback for that team), so the page is not a dead end.
- Files: `src/routes/_authenticated/teams.tsx`.
- Risk: low. Migration: no. Explicitly **no** permission/RLS change.

### P2

**P2-1 — Extract the shared "responsive data list" pattern.** `/performance` (`:791, 871`) and `/feedback` (`:1731, 1762`) hand-roll the same table/card split with different trigger conditions. A shared component would stop drift and make P0-1 cheap. Files: new `src/components/ui/responsive-list.tsx` + the two routes. Risk: medium (touches two large surfaces). Migration: no.

**P2-2 — Unify "manager only" gating.** `/communications` gates the whole page with a `ShieldAlert` EmptyState (`:70-80`); `/competitions` and `/knowledge` degrade per-button via `ManagerOnly`. Pick one convention and document it. Risk: low.

**P2-3 — `/feedback` 7-tab bar on mobile.** `flex flex-wrap h-auto` (`feedback.tsx:314`) wraps to 2–3 rows before any content. Consider a select-based tab picker under `sm`, the way `/ai-insights` explicitly solved Hebrew label clipping (`ai-insights.tsx:260-262`). Risk: low.

**P2-4 — `/performance` coaching section collapsed by default.** "הקשר ותובנות ניהול" hides coaching priorities behind a click every visit (`performance.tsx:615-721`). Remember the open/closed state per user in local UI preferences. Risk: low.

**P2-5 — De-duplicate the "missing targets" Hebrew pluralization**, implemented separately in `performance.tsx:600-609` and `communications.tsx:311-316`. Move to `src/lib/format.ts`. Risk: low.

**P2-6 — MorningRoutine first paint.** Four async operations fire on mount with no card-level skeleton, so "לא זמין" trend text can flash before snapshots settle (`MorningRoutine.tsx:199-355`). Add a single card-level loading state. Risk: low.

**P2-7 — Inconsistent EmptyState thoroughness.** Several `/feedback` empty states have a title only (`:563, 861, 874, 1058, 1608`) while others carry a description and CTA. Normalize to title + description + next action.

**P2-8 — `/users` error state has no retry** (`users.tsx:312-313`) while `/teams` and `/targets` do. Align.

## 3. Business-scope import UX — next phase

**Problem it solves.** The hierarchy now resolves a real scope for every manager, and `/data-import` already *states* it (`ImportScopeCard`, `data-import.tsx:98-121`). What it does not do is let the scope shape the import. Today a center or activity manager uploads one file, maps a free-text "צוות" column, and discovers only at the summary step which rows landed outside their scope or matched no team at all. The scope is a notice, not a working part of the wizard.

**What to add to `/data-import` (presentation and client-side logic only):**

1. **Target-team selector bound to scope.** Before mapping, let the manager choose "the file covers a single team" (pick from the scoped team list) or "the file contains a צוות column". Single-team mode removes the most common mapping mistake outright.
2. **Team-value reconciliation step.** After mapping, show each distinct value in the צוות column with its resolved team, its KPI profile badge, and its row count — with a per-value picker for unresolved names. Unresolved names currently fail silently row-by-row.
3. **Out-of-scope rows surfaced before commit.** A dedicated banner and filter chip: "N שורות שייכות לצוותים מחוץ להיקף שלך ולא ייובאו", listing the team names. The server funnel already blocks these; the UI should say so up front rather than at the summary.
4. **KPI-profile-aware mapping.** When every in-scope target team is generic, hide the renewals field group entirely instead of labeling it optional; when the file mixes generic and renewals teams, show which teams will silently drop the renewal columns.
5. **Scope-aware history.** Filter the import history list by the resolved scope and show the team each import touched, so a center manager can answer "who last imported for חידושי רכב".

None of this needs a migration, an RLS change, or a new server function: the scope payload (`useBusinessScope`) and the processed-row array are already client-side. It is a rearrangement of the wizard around information the app already has.

## 4. Quick-win PR candidates (one at a time)

1. Tooltips on disabled user actions (P1-2) — `users.tsx`, tiny.
2. Retry button on the `/users` load error (P2-8) — copy the `/teams` pattern.
3. Tokenize the four raw colors (P1-3) — `styles.css` + 3 routes.
4. `/knowledge` loading skeleton (P1-4).
5. `/competitions` search + status filter (P1-5).
6. Import preview: pagination + status filter chips (P0-2).
7. `/users` mobile card list (P0-1).
8. Audit-log filters, pagination and readable details (P1-1).
9. Remember `/performance` coaching section open state (P2-4).
10. Shared pluralization helper for missing targets (P2-5).

Items 1–5 are each under ~50 lines and independently shippable; 6–8 are the highest-value ones.

## 5. Boundaries observed

No database migration is required for any item above. No RLS, auth or role-permission change is proposed — P1-6 is framing and links only. No CRM, worklist, queue, customer, policy or call-outcome concept appears anywhere in this report.
