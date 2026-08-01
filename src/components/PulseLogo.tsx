import { cn } from "@/lib/utils";

export type PulseLogoVariant = "full" | "symbol" | "light" | "dark" | "compact";

/**
 * Shared geometry — keep in sync with public/brand/pulse-symbol.svg,
 * pulse-logo.svg, pulse-logo-light.svg and public/favicon.svg if this ever
 * changes; those static files exist for contexts that need a real asset URL
 * (favicon links, `<img>`/download, external use) rather than an inline
 * component.
 */
const RING_PATH = "M 80.53 69.07 A 36 36 0 1 1 80.53 30.93";
const HEARTBEAT_PATH = "M 8 50 L 31 50 L 40 28 L 51 74 L 61 34 L 68 50 L 92 50";
const HEARTBEAT_COLOR = "#FFC107"; // brand accent yellow — fixed across every variant
const RING_COLOR_ON_LIGHT = "#4B1D6D"; // brand primary deep purple
const RING_COLOR_ON_DARK = "#FFFFFF";
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
   * light   — mark + wordmark rendered in white, for placement on dark/purple backgrounds
   * dark    — mark + wordmark, standard (dark-on-light) colors — explicit alias of `full`,
   *           for call sites that want to be unambiguous about which background they expect
   */
  variant?: PulseLogoVariant;
  title?: string;
  className?: string;
}) {
  const onDark = variant === "light";
  const ring = onDark ? RING_COLOR_ON_DARK : RING_COLOR_ON_LIGHT;
  const text = onDark ? TEXT_COLOR_ON_DARK : TEXT_COLOR_ON_LIGHT;
  const showWordmark = variant !== "symbol";
  const compact = variant === "compact";

  return (
    <span className={cn("inline-flex h-8 items-center", compact ? "gap-1.5" : "gap-2.5", className)}>
      <svg
        viewBox="0 0 100 100"
        className="h-full w-auto shrink-0"
        role={showWordmark ? undefined : "img"}
        aria-hidden={showWordmark ? true : undefined}
        aria-label={showWordmark ? undefined : title}
      >
        {!showWordmark && <title>{title}</title>}
        <path d={RING_PATH} fill="none" stroke={ring} strokeWidth={10} strokeLinecap="round" />
        <path
          d={HEARTBEAT_PATH}
          fill="none"
          stroke={HEARTBEAT_COLOR}
          strokeWidth={7}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {showWordmark && (
        <span
          className={cn(
            "whitespace-nowrap font-extrabold leading-none tracking-tight",
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
