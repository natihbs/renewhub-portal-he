# MINDTRAP · EXPERIMENT 001: THE INEVITABLE

A mobile-first, Hebrew (RTL) psychological-thriller web experience. The visitor
makes four free choices on a 4×4 matrix and tries to escape a prediction that
was sealed with a cryptographic commitment before their first choice.

It runs entirely in the browser: no accounts, no database, no analytics, no paid
APIs, no data leaves the device.

## How it works (spoiler)

- **The matrix** is the fixed, public grid `1–16`. Picking a cell locks every
  other cell in its row and column, so after four picks the visitor holds exactly
  one cell from every row and every column. Since `value = 4·row + col + 1`, the
  sum is always `4·(0+1+2+3) + (0+1+2+3) + 4 = 34`. There are 576 legal ordered
  sequences (24 distinct sets), and all of them sum to 34. Nothing is altered or
  manipulated behind the scenes.
- **The sealed prediction** is a hash commitment made when the visitor enters the
  experiment:
  ```
  nonce      = 32 random bytes from crypto.getRandomValues (hex)
  preimage   = JSON.stringify(["MINDTRAP/EXP-001/v1", "34", nonce])
  commitment = SHA-256(UTF-8(preimage))   // hex
  ```
  The commitment is shown (and can be copied) before gameplay. After the reveal,
  the prediction, nonce and method are disclosed, and **Verify** recomputes the
  hash on the device. The fields can be edited to show that any change fails.
  The page also gives a `printf … | sha256sum` one-liner for checking outside
  the site.
- **What the commitment does and doesn't prove:** it shows the prediction was
  fixed before the reveal *within this session*. It is not a trusted external
  timestamp. The commitment is never regenerated during play. Undo and Restart
  only clear choices. **Try again** after the reveal starts a new, clearly
  labelled session (new session ID and hash, with the previous one shown as no
  longer valid).

## Tech stack

Next.js 16 (App Router) · TypeScript · Tailwind CSS 4 · Framer Motion · Lucide ·
self-hosted fonts via Fontsource (Frank Ruhl Libre, Heebo, IBM Plex Mono) ·
Vitest · Playwright.

## Project structure

```
mindtrap/
├── src/
│   ├── app/
│   │   ├── layout.tsx            # <html lang="he" dir="rtl">, fonts, metadata
│   │   ├── page.tsx              # renders <Experiment />
│   │   ├── globals.css           # design tokens, atmosphere, buttons
│   │   ├── icon.svg              # favicon
│   │   └── opengraph-image.tsx   # spoiler-free share image
│   ├── components/
│   │   ├── Experiment.tsx        # state machine host, header/footer, transitions
│   │   ├── screens/
│   │   │   ├── IntroScreen.tsx        # 1 · Initiation
│   │   │   ├── SealedScreen.tsx       # 2 · Sealed prediction (hash, copy)
│   │   │   ├── ChamberScreen.tsx      # 3 · 4×4 selection chamber
│   │   │   ├── CalculationScreen.tsx  # 4 · Sum
│   │   │   └── RevealScreen.tsx       # 5 · Reveal, verify, retry, share
│   │   ├── VerifyPanel.tsx       # local recomputation + tamper test
│   │   ├── CopyButton.tsx, Ltr.tsx, ScreenHeading.tsx
│   └── lib/
│       ├── engine.ts             # matrix, select/undo/restart, enumeration
│       ├── commitment.ts         # nonce, serialization, SHA-256, verify
│       ├── experiment.ts         # screen-flow reducer
│       ├── share.ts, clipboard.ts
├── tests/
│   ├── unit/                     # Vitest: engine, commitment, flow
│   └── e2e/                      # Playwright: main flow, keyboard, share, RTL
└── playwright.config.ts, vitest.config.mts, next.config.ts
```

## Getting started

Requires Node.js 20.9+ (tested with Node 22).

```bash
cd mindtrap
npm install
npm run dev          # http://localhost:3000
```

> Web Crypto (`crypto.subtle`) only works in a secure context: `localhost` or
> HTTPS. If you open the dev server from a phone over plain-HTTP LAN, sealing
> will fail with a clear error message. Use HTTPS (e.g. a Vercel preview).

## Scripts

| Command              | What it does                                         |
| -------------------- | ---------------------------------------------------- |
| `npm run dev`        | Local development server                             |
| `npm run build`      | Production build                                     |
| `npm start`          | Serve the production build                           |
| `npm run typecheck`  | `tsc --noEmit`                                       |
| `npm test`           | Unit tests (Vitest)                                  |
| `npm run test:e2e`   | End-to-end tests (Playwright; builds and starts the app on port 3100) |
| `npm run check`      | typecheck + unit tests + build                       |

### Tests

Unit tests (`tests/unit`, 603 tests):

- exhaustively enumerate **all 576 ordered selection sequences** and assert each
  has four unique rows, four unique columns, and sums to 34
- check that invalid selections (locked, duplicate, out of bounds, fifth pick)
  are rejected without mutating state
- check that Undo restores availability exactly at every depth of every sequence
- check that Restart clears the previous game state
- check that the commitment verifies, matches Node's independent SHA-256, and
  that a modified prediction, nonce or hash fails
- check that the flow reducer never replaces the commitment during play and that
  a new session is distinct

End-to-end tests (`tests/e2e`) run on a Pixel 7 profile and a desktop Chrome
profile. They cover RTL and horizontal overflow, the full flow (seal → lock/undo/restart
→ reveal → verify → tamper → new session), keyboard-only play with reduced
motion, and a check that shared text never contains the prediction.

First-time Playwright setup on a new machine: `npx playwright install chromium`.
To use an existing Chromium binary instead, set `PLAYWRIGHT_CHROMIUM_PATH`.

## Deploying to Vercel

This app lives in the `mindtrap/` subfolder of the repository.

1. Push the branch to GitHub.
2. In Vercel: **Add New… → Project**, then import the repository.
3. Set **Root Directory** to `mindtrap`. Vercel detects Next.js automatically
   (build `next build`, output `.next`).
4. No environment variables are required. `VERCEL_PROJECT_PRODUCTION_URL` is
   provided by Vercel and used for absolute Open Graph URLs.
5. Deploy.

Or from the CLI:

```bash
cd mindtrap
npx vercel          # preview
npx vercel --prod   # production
```

## Accessibility and UX notes

- Full RTL. English labels, hashes and equations are bidi-isolated, so the layout
  doesn't break with mixed directions. The matrix itself is shown in its
  canonical left-to-right order (1 top-left, 16 bottom-right).
- Tiles are real `<button>`s at least 56px tall, with descriptive Hebrew labels
  (number, row, column, state) and `aria-pressed`. Locked tiles are `disabled`.
  Arrow keys move between open tiles, and focus is never lost after a pick.
- Focus moves to each screen's heading on transition. Progress is announced via
  an `aria-live` region.
- `prefers-reduced-motion` is respected globally (`MotionConfig reducedMotion="user"`
  plus instant elimination and count-up).
- No sound and no autoplay. Includes an entertainment disclaimer.
