/**
 * Phase 2 dashboard surfaces — presentation only.
 *
 * The home screens previously rendered one undifferentiated stack of Cards,
 * so nothing said which number mattered first. These primitives give the
 * dashboards four deliberate weights (hero / standard / compact / attention),
 * a ring + bar visual vocabulary for the metrics that already exist, and
 * initials avatars for people rows. No data is derived here: every component
 * renders exactly what it is handed.
 */
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// --------------------------------------------------------------- section

/** Group label with a brand rule — the seam between dashboard zones. */
export function SectionHeading({
  title,
  hint,
  action,
  className,
}: {
  title: string;
  hint?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3 sm:flex sm:justify-between",
        className,
      )}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span aria-hidden className="section-rule" />
          <h2 className="truncate font-display text-base font-bold tracking-tight sm:text-lg">
            {title}
          </h2>
        </div>
        {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      </div>
      {action}
    </div>
  );
}

// ------------------------------------------------------------------ hero

/** The dominant surface of a screen: dark brand gradient, white content. */
export function HeroPanel({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("surface-hero rounded-3xl p-5 sm:p-7", className)}>
      <div className="relative">{children}</div>
    </section>
  );
}

/** A single figure inside the hero — readable on the dark gradient. */
export function HeroStat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="min-w-0 rounded-2xl bg-white/10 px-4 py-3 backdrop-blur-sm">
      <div className="truncate text-[11px] font-medium uppercase tracking-wide text-white/70">
        {label}
      </div>
      <div className="num mt-1 truncate font-display text-2xl font-extrabold sm:text-3xl">
        {value}
      </div>
      {sub && <div className="mt-0.5 truncate text-xs text-white/70">{sub}</div>}
    </div>
  );
}

// ------------------------------------------------------------ progress ring

/**
 * Circular progress for an achievement percentage. `value` may exceed 100 —
 * the arc caps at the ring, the printed figure does not, so over-performance
 * still reads as over-performance. A null value renders an empty ring and a
 * dash rather than a fabricated zero.
 */
export function ProgressRing({
  value,
  caption,
  size = 116,
  tone = "primary",
  className,
}: {
  value: number | null;
  caption?: string;
  size?: number;
  tone?: "primary" | "success" | "warning" | "onDark";
  className?: string;
}) {
  const stroke = 10;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pctForArc = value === null ? 0 : Math.max(0, Math.min(value, 100));
  const dash = (pctForArc / 100) * c;
  const strokeColor =
    tone === "success"
      ? "var(--color-success)"
      : tone === "warning"
        ? "var(--color-warning)"
        : tone === "onDark"
          ? "var(--color-brand-accent)"
          : "var(--color-primary)";
  const trackColor =
    tone === "onDark" ? "rgb(255 255 255 / 0.22)" : "color-mix(in oklab, var(--color-muted) 90%, transparent)";
  return (
    <div className={cn("relative shrink-0", className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={trackColor}
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={strokeColor}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${c - dash}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          className="transition-[stroke-dasharray] duration-700 ease-out"
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        <div>
          <div className="num font-display text-xl font-extrabold leading-none sm:text-2xl">
            {value === null ? "—" : `${Math.round(value)}%`}
          </div>
          {caption && (
            <div
              className={cn(
                "mt-1 text-[10px] leading-tight",
                tone === "onDark" ? "text-white/70" : "text-muted-foreground",
              )}
            >
              {caption}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------- stat tile

/** Compact metric tile for dense KPI rows. */
export function StatTile({
  icon: Icon,
  label,
  value,
  sub,
  tone,
  className,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  sub?: string;
  tone?: "success" | "warning" | "danger";
  className?: string;
}) {
  const valueColor =
    tone === "success"
      ? "text-success-foreground"
      : tone === "warning"
        ? "text-warning-foreground"
        : tone === "danger"
          ? "text-primary"
          : "text-foreground";
  return (
    <div className={cn("surface-tile p-4", className)}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 text-xs font-medium text-muted-foreground">{label}</div>
        {Icon && (
          <div className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-accent text-primary">
            <Icon className="h-3.5 w-3.5" />
          </div>
        )}
      </div>
      <div className={cn("num mt-2 truncate font-display text-2xl font-extrabold", valueColor)}>
        {value}
      </div>
      {sub && <div className="mt-0.5 truncate text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

// ---------------------------------------------------------------- people

/** Hebrew-safe initials: first letters of the first two name parts. */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return parts
    .slice(0, 2)
    .map((p) => p[0])
    .join("");
}

const AVATAR_TINTS = [
  "bg-primary/12 text-primary",
  "bg-[color:var(--info)]/15 text-[color:var(--info-foreground)]",
  "bg-[color:var(--success)]/15 text-success-foreground",
  "bg-[color:var(--warning)]/15 text-warning-foreground",
  "bg-accent text-accent-foreground",
] as const;

/** Deterministic tint so the same person keeps the same color across screens. */
function tintFor(name: string): string {
  let sum = 0;
  for (const ch of name) sum += ch.charCodeAt(0);
  return AVATAR_TINTS[sum % AVATAR_TINTS.length];
}

export function InitialsAvatar({
  name,
  className,
}: {
  name: string;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid h-9 w-9 shrink-0 place-items-center rounded-full font-display text-xs font-bold",
        tintFor(name),
        className,
      )}
    >
      {initialsOf(name)}
    </span>
  );
}

/** Ranked person row: medal rank, avatar, name, meta and a value bar. */
export function RankedRow({
  rank,
  name,
  meta,
  value,
  barPct,
  tone = "primary",
}: {
  rank: number;
  name: string;
  meta?: ReactNode;
  value: string;
  barPct: number;
  tone?: "primary" | "success";
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border/70 p-3 transition-colors hover:bg-surface-subtle">
      <span
        className={cn(
          "num grid h-6 w-6 shrink-0 place-items-center rounded-full font-display text-xs font-bold",
          rank === 1
            ? "bg-[color:var(--warning)]/20 text-warning-foreground"
            : "bg-muted text-muted-foreground",
        )}
      >
        {rank}
      </span>
      <InitialsAvatar name={name} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate font-semibold">{name}</span>
          {meta}
        </div>
        <div className="mt-1.5 flex items-center gap-2">
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className={cn(
                "h-full rounded-full transition-[width] duration-700 ease-out",
                tone === "success" ? "bg-[color:var(--success)]" : "bg-primary",
              )}
              style={{ width: `${Math.max(0, Math.min(barPct, 100))}%` }}
            />
          </div>
          <span className="num w-14 shrink-0 text-end text-xs text-muted-foreground">{value}</span>
        </div>
      </div>
    </div>
  );
}
