# Pulse — Visual/UX Polish Audit (consultation only)

Read-only review of `src/styles.css`, `PulseLogo.tsx`, brand SVGs, `AppShell.tsx`, `HomeCards`/`ScopeHomeCards`, the authenticated routes, and `auth.tsx`. No code changed.

## Visual strengths today

- One real token system. `--brand-*` → semantic tokens → shadcn variables, with a documented reason for `--success-foreground` / `--warning-foreground` (`styles.css:109-124`). Dark mode is a genuine re-map, not an inversion.
- Mobile-first primitives already correct: every button size clears 44px (`ui/button.tsx:22-27`), bottom nav is 4+"עוד" with `min-h-14` and safe-area padding (`AppShell.tsx:503-550`).
- RTL is real, not flipped LTR: `me-*/ms-*` logical spacing, `dir="rtl"` on dialogs, Hebrew copy that explains *why* (locked workspace label, `AppShell.tsx:305-317`).
- Restraint. No gradient-soup dashboard template; density is close to what a manager needs.

## Highest-impact visual issues

1. **Flatness by uniformity.** Every surface is the same `Card`: `rounded-xl border shadow` + `p-6` header (`ui/card.tsx:9,19`). A KPI hero, a list card, and a status chip block all read at identical weight, so nothing leads the eye. This is the single biggest "not premium yet" factor.
2. **Outline-button noise.** 29 outline buttons in `feedback.tsx`, 26 in `users.tsx`, 14 in `data-import.tsx`, 13 in `index.tsx`. When everything is a bordered box, no action is primary.
3. **Header control stack.** `NotificationBell + AdminViewSwitcher + WorkspaceSwitcher + RoleSwitcher + UserMenu + About + Search` in one row (`AppShell.tsx:610-624`); for an admin in a non-default view that's five interactive widgets plus a banner underneath.
4. **Yellow is doing two jobs.** `--brand-accent #FFC107` is both the logo heartbeat and, via `--warning`, the alert hue. Brand energy and "something is wrong" should never share a color.
5. **Remaining raw colors** — `bg-[#e8f0e6]` / `bg-white` / `text-emerald-700` (`communications.tsx:451-453`), `text-yellow-500` / `text-amber-700` (`competitions.tsx:556-558`), `text-yellow-500` + `bg-yellow-500 text-white` (`knowledge.tsx:123,165`), `text-white` on a competition badge (`competitions.tsx:61`). All break dark mode.

## 1. Brand identity and logo

**Verdict: evolve, don't replace.** The ring + heartbeat is well built (single shared geometry across component and four SVG assets, `PulseLogo.tsx:12-18`) but the ECG trace is the universal medical signifier — with an open C-ring around it, it reads clinic monitor before sales floor. The wordmark is also Latin-only, in a Hebrew-first product.

Directions (name stays "Pulse"):

- **A — Rhythm bars.** Replace the ECG trace with 3-5 vertical bars of rising height, the tallest capped by an accent dot. Reads as performance/measurement, keeps the "pulse" metaphor as beat rather than heartbeat. Best 16px survivability: at favicon size it collapses to three legible strokes.
- **B — Momentum arc.** Keep the open ring, replace the trace with a single ascending stroke that breaks *through* the ring gap. Reads as trajectory and breakout; the gap becomes intentional (progress, not closure). Highest brand distinctiveness, slightly weaker at 16px — needs a thicker-stroke micro variant.
- **C — Beat dot cluster.** A ring of unevenly weighted dots with one filled accent dot — team rhythm, individuals in a cadence. Most abstract, best at tiny sizes, weakest as a standalone story.

Recommendation: **A** as the safe evolution, **B** if you want a mark that is actually memorable. Either way add: a dedicated 16px variant with heavier stroke and no wordmark, a Hebrew lockup ("פאלס" or the Latin mark beside a Hebrew descriptor), and a `currentColor` mode so the mark inherits sidebar/dark surfaces instead of hard-coding `#4B1D6D`/`#FFFFFF` (`PulseLogo.tsx:15-18`).

## 2. Color system

Purple + yellow works and is genuinely un-generic — keep it. Refinements:

- **Split accent from warning.** Keep `--brand-accent` for the logo/celebratory moments only; give `--warning` its own amber that is *not* `#FFC107`. Today the same hue means "brand" and "attention".
- **Sidebar weight.** `--sidebar: var(--brand-primary)` is a full-saturation purple slab down the whole page — the heaviest object on screen at all times. Lighten to a deep desaturated purple (or `color-mix` toward the background), or keep the slab but reduce it to a rail on `xl+`.
- **Card/background separation.** `#F7F8FC` vs `#FFFFFF` at `shadow` strength gives a low-contrast boundary; either deepen the page background one step or drop card shadows in favor of a crisper border. Pick one — not both.
- **Add tokens** rather than new hex: `--surface-subtle` (list rows, currently ad-hoc `bg-muted/40`), `--chat-surface`/`--chat-bubble` for the WhatsApp mock, `--info` / `--info-foreground` (blue is currently improvised per page).
- Dark mode is fine as-is; any new token needs both blocks.

## 3. Typography

Heebo body + Rubik display is a good Hebrew-first pairing — keep it. Issues:

- Rubik is declared as `--font-display` (`styles.css:9`) but essentially unused; headings render in Heebo. Either wire `font-display` into `h1/h2` and `CardTitle`, or drop the token. Right now you pay for a font you don't show.
- **No numeric treatment.** KPI figures are the product; they should be tabular-lining (`font-variant-numeric: tabular-nums`) so columns align in RTL tables and counters don't jitter. Add a `@utility num` and apply to KPI values, table numbers, and progress figures.
- **Card titles are undersized and inconsistent** — `text-base` at some call sites, default at others (`HomeCards.tsx:270,396`). Define three levels: page `text-2xl/font-display`, card `text-base font-semibold`, section label `text-xs font-semibold text-muted-foreground uppercase-ish`.
- Hebrew needs slightly more line-height than the shadcn default; `leading-relaxed` on body copy blocks and `leading-none` only on numbers.

## 4. Cards and dashboard density

Define three explicit card levels instead of one:

- **Hero KPI** — larger radius, no border, tinted surface or subtle accent edge, oversized tabular number, single trend line. One per page maximum.
- **Standard card** — today's card, but header padding down from `p-6` to `px-5 py-4` and content `px-5 pb-5`. That recovers ~16px per card without touching density of information.
- **Compact status card** — border only, no shadow, `rounded-lg`, used for the `StatChip` rows and inline summaries.

Also: progress bars are visually identical regardless of meaning; give at-risk/on-track a token-based fill rather than a color class per call site. Badges are the most inconsistent primitive in the app (raw colors, `/15` tints, `variant="secondary"` overrides) — one badge scale (neutral/info/success/warning/danger) would remove most of the remaining raw-color leaks.

## 5. Buttons and actions

- One primary per view. Convert secondary row-level outlines to `ghost` (icon + label), keep `outline` for genuinely paired choices only.
- Table row actions: collapse "עריכה / השבתה / מחיקה" outlines into a single `⋯` dropdown, as `/users` partly already does.
- Mobile: `size="sm"` currently still forces `min-h-11` (correct) but pairs it with `text-xs` — at 44px tall with 12px text the control looks empty. Use `text-sm` under `sm:`.
- Destructive actions should be `ghost` + destructive text until confirmation, never a filled red button in a list.

## 6. Navigation and shell

- Move `About` and `ModeToggle` fully into the user menu (About already exists there, `AppShell.tsx:461-464` — the header copy is redundant).
- Group the scope widgets: `AdminViewSwitcher + WorkspaceSwitcher` in one bordered segment with a divider, so it reads as "context" rather than two unrelated selects.
- Sidebar active state is color-only; add a 3px inline-start accent bar plus a subtle filled pill — clearer at a glance and survives color-blind users.
- Bottom nav active state (`text-primary` + `stroke-[2.4]`) is weak on the tinted card background; add a small top indicator bar or a filled icon pill.
- `AdminViewBanner` is a full-width strip pushing content down on every admin view; a compact inline chip next to the switcher would carry the same message with less shove.

## 7. Tables, forms, filters

- **One filter toolbar pattern**, reused: a single `rounded-xl border bg-card` bar containing search (grows), 1-3 selects, and a result-count on the far side, collapsing to a sheet on mobile. Today `/knowledge`, `/users`, `/feedback` and `/targets` each hand-roll a different arrangement, and `/competitions` has none.
- Sticky table headers inside the existing scroll container; row hover currently varies by page.
- Prefer section grouping (`/targets`-style) over zebra striping — zebra plus RTL plus dense Hebrew is noisy.
- Dialogs: standardize on `sm:max-w-md` for confirmations and `sm:max-w-2xl` for editors; several are ad-hoc.

## 8. Empty / loading / error states

- Consolidate on one `EmptyState` shape everywhere: muted icon in a tinted circle, title, one-sentence description, one action. Several `/feedback` empties are title-only.
- Skeletons should mirror the real layout (card skeleton for card grids), not a generic `h-10` bar stack (`HomeCards.tsx:92-95`).
- Warning fatigue: `/data-import` can show an inactive-match banner, an unmatched banner, a warning alert and colored stat chips at once. Cap it at one banner plus counts.
- Error blocks: neutral surface + destructive icon and text, not a red-tinted card, unless the action is blocked.

## 9. Mobile

- Header on a phone: logo + title + search icon + bell + workspace select + avatar is at the edge of fitting; the workspace select at `w-40` is the first thing to squeeze.
- `/feedback` tab bar wraps to 2-3 rows before any content (`feedback.tsx:314`) — use a select-based tab picker under `sm`.
- Tables converted to cards are good, but `/users` still has no mobile card list (name + status only on a phone).
- Filter bars should collapse into a "סינון" button opening a bottom sheet, with an active-filter count badge.

## 10. Motion and micro-interactions

Keep it near-invisible: 150-200ms color/opacity on hover and active nav, `transition-shadow` on interactive cards (the `card-interactive` utility already exists — use it consistently), animated progress-bar fill on first paint only, count-up on hero KPI numbers only, and a 120ms scale-down on press for mobile. Everything behind `motion-safe:`; the login heartbeat already does this correctly (`auth.tsx:50`).

## 11. Product personality

**Calm, sharp, Hebrew-native, momentum-aware, trustworthy.**

At 8:00 AM a manager should open Pulse and feel it has already done the thinking: one clear headline number, two things that need attention today, and nothing shouting. Quiet until something matters — then unmistakably clear about what and why.

## 12. Prioritized plan

**P0**

- **P0-1 Card hierarchy + spacing scale.** Three card levels, tighter default padding, one badge scale. Files: `ui/card.tsx`, `ui/badge.tsx`, `styles.css`, home + performance surfaces. Risk: medium (touches every page). Migration: no.
- **P0-2 Kill remaining raw colors.** `communications.tsx:451-453`, `competitions.tsx:61,556-558`, `knowledge.tsx:123,165` + new `--chat-*` and `--info` tokens. Risk: low. Migration: no.
- **P0-3 Action hierarchy pass.** Outline → ghost on secondary actions, row actions into `⋯` menus, one primary per view. Files: `feedback.tsx`, `users.tsx`, `data-import.tsx`, `index.tsx`. Risk: low-medium. Migration: no.

**P1**

- **P1-1 Header/scope grouping + About/ModeToggle into user menu.** `AppShell.tsx`. Risk: low.
- **P1-2 Shared filter-toolbar component** + adoption on `/users`, `/knowledge`, `/competitions`, `/feedback`. New `components/ui/filter-bar.tsx`. Risk: medium.
- **P1-3 Typography scale + tabular numerals.** `styles.css`, `ui/card.tsx`, KPI call sites. Risk: low.
- **P1-4 Logo evolution (direction A or B)** + 16px variant + `currentColor` mode + Hebrew lockup. `PulseLogo.tsx`, `public/brand/*`, `favicon.svg`. Risk: low, high perceived impact.

**P2**

- Sidebar weight reduction and active-state accent bar.
- Skeletons that mirror layout; `EmptyState` normalization.
- Bottom-nav active indicator; `/feedback` mobile tab select; `/users` mobile card list.
- Motion pass (`card-interactive` adoption, progress fill, KPI count-up).

**Shippable small PRs (in order)**

1. Raw-color/token cleanup (P0-2) — ~5 files, self-contained.
2. Typography + tabular numerals (P1-3).
3. Header grouping and control reduction (P1-1).
4. Card padding/hierarchy primitives only, no page rewrites (first half of P0-1).
5. Logo evolution + favicon set (P1-4).

**Then: "Visual Polish v1"** — one cohesive package applying the new card hierarchy, badge scale, action hierarchy and shared filter toolbar across the major surfaces at once, so no page is left half-migrated. That package is the right place to also do sidebar weight, empty/skeleton normalization and the motion pass.

No database migration, no RLS/auth/role change, and no CRM/worklist/queue/customer/policy/call-outcome concept is required or proposed anywhere above.
