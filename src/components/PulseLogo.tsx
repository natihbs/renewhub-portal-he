import { cn } from "@/lib/utils";

export type PulseLogoVariant = "full" | "symbol" | "light" | "dark" | "compact";

/**
 * Pulse mark — four ascending "rhythm bars" (performance pulse), deliberately
 * NOT the old ECG/heartbeat trace, which read as healthcare rather than sales
 * performance. Keep geometry in sync with public/brand/pulse-symbol.svg,
 * pulse-logo.svg, pulse-logo-light.svg and public/favicon.svg; those static
 * files exist for contexts that need a real asset URL (favicon links,
 * `<img>`/download, external use) rather than an inline component.
 *
 * The three lower bars render in `currentColor` at stepped opacity, so the
 * mark inherits whatever text color its container sets and works on light,
 * dark and sidebar surfaces without a per-surface asset. Only the tallest bar
 * is fixed to the brand accent (cyan) as the single highlight.
 */
const BARS: { x: number; h: number; opacity: number }[] = [
  { x: 9, h: 26, opacity: 0.4 },
  { x: 30.5, h: 46, opacity: 0.6 },
  { x: 52, h: 68, opacity: 0.85 },
];
const BAR_W = 15;
const BAR_R = 7.5;
const BASELINE = 90;
/** The tallest, highlighted bar. */
const ACCENT_BAR = { x: 73.5, h: 88 };

const ACCENT_ON_LIGHT = "#0891B2"; // cyan-600 — >=4.5:1 on white
const ACCENT_ON_DARK = "#22D3EE"; // cyan-400
const MARK_COLOR_ON_LIGHT = "#4C1D95"; // brand primary (violet-900)
const MARK_COLOR_ON_DARK = "#FFFFFF";
const TEXT_COLOR_ON_LIGHT = "#1F2937"; // brand-text
const TEXT_COLOR_ON_DARK = "#FFFFFF";

export function PulseLogo({
  variant = "full",
  title = "Pulse",
  className,
}: {
  /**
   * full    — mark + wordmark, standard colors, roomy spacing (sidebar brand block, About dialog)
   * symbol  — mark only, no wordmark (favicon-style usage, avatars, tight square slots)
   * compact — mark + wordmark, tight spacing/smaller wordmark (mobile header bar)
   * light   — mark + wordmark rendered in white, for placement on dark/navy backgrounds
   * dark    — mark + wordmark, standard (dark-on-light) colors — explicit alias of `full`,
   *           for call sites that want to be unambiguous about which background they expect
   */
  variant?: PulseLogoVariant;
  title?: string;
  className?: string;
}) {
  const onDark = variant === "light";
  const mark = onDark ? MARK_COLOR_ON_DARK : MARK_COLOR_ON_LIGHT;
  const accent = onDark ? ACCENT_ON_DARK : ACCENT_ON_LIGHT;
  const text = onDark ? TEXT_COLOR_ON_DARK : TEXT_COLOR_ON_LIGHT;
  const showWordmark = variant !== "symbol";
  const compact = variant === "compact";

  return (
    <span className={cn("inline-flex h-8 items-center", compact ? "gap-1.5" : "gap-2.5", className)}>
      <svg
        viewBox="0 0 100 100"
        className="h-full w-auto shrink-0"
        style={{ color: mark }}
        role={showWordmark ? undefined : "img"}
        aria-hidden={showWordmark ? true : undefined}
        aria-label={showWordmark ? undefined : title}
      >
        {!showWordmark && <title>{title}</title>}
        {BARS.map((b) => (
          <rect
            key={b.x}
            x={b.x}
            y={BASELINE - b.h}
            width={BAR_W}
            height={b.h}
            rx={BAR_R}
            fill="currentColor"
            opacity={b.opacity}
          />
        ))}
        <rect
          x={ACCENT_BAR.x}
          y={BASELINE - ACCENT_BAR.h}
          width={BAR_W}
          height={ACCENT_BAR.h}
          rx={BAR_R}
          fill={accent}
        />
      </svg>
      {showWordmark && (
        <span
          className={cn(
            "whitespace-nowrap font-display font-extrabold leading-none tracking-tight",
            compact ? "text-base" : "text-xl",
          )}
          style={{ color: text }}
        >
          {title}
        </span>
      )}
    </span>
  );
}
