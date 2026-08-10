import { cn } from "@/lib/utils";

export type PulseLogoVariant = "full" | "symbol" | "light" | "dark" | "compact";

/**
 * Pulse mark — one continuous abstract signal waveform with a cyan "live"
 * node at its end. Replaces the previous four-vertical-bar mark, which real
 * desktop QA flagged as readable as a raised-finger silhouette. The trace is
 * deliberately smooth-jointed and asymmetric so it reads as a performance
 * signal, not a hospital ECG. Keep geometry in sync with
 * public/brand/pulse-symbol.svg, pulse-logo.svg, pulse-logo-light.svg and
 * public/favicon.svg; those static files exist for contexts that need a real
 * asset URL (favicon links, `<img>`/download, external use) rather than an
 * inline component.
 *
 * The trace renders in `currentColor`, so the mark inherits whatever text
 * color its container sets and works on light, dark and sidebar surfaces
 * without a per-surface asset. Only the end node is fixed to the brand accent
 * (cyan) as the single highlight.
 */
const WAVE_PATH = "M6 62 H22 L38 28 L58 78 L72 48 H79";
const WAVE_STROKE = 12;
/** The accent "live signal" node at the end of the trace. */
const ACCENT_NODE = { cx: 91, cy: 48, r: 7.5 };

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
        <path
          d={WAVE_PATH}
          fill="none"
          stroke="currentColor"
          strokeWidth={WAVE_STROKE}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx={ACCENT_NODE.cx} cy={ACCENT_NODE.cy} r={ACCENT_NODE.r} fill={accent} />
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
