import type { ReactNode } from "react";

/**
 * Page identity band — every authenticated route opens with one.
 *
 * A defined brand surface (faint primary-tinted gradient on the card color,
 * see `surface-page-header` in styles.css) instead of a bare title floating on
 * the page background, so routes read as part of the same product as the
 * dashboard hero. `icon` is decorative page iconography, not a control.
 */
export function PageHeader({
  title,
  description,
  actions,
  icon: Icon,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
}) {
  return (
    // Phones stack the title above the actions; wide screens keep the single row.
    <header className="surface-page-header flex flex-col gap-3 rounded-2xl p-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:p-5">
      <div className="flex min-w-0 items-center gap-3">
        {Icon && (
          <div
            aria-hidden
            className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary sm:h-12 sm:w-12"
          >
            <Icon className="h-5 w-5 sm:h-6 sm:w-6" />
          </div>
        )}
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {/* Same brand rule the dashboard section headings use, so page titles
                and in-page groups read as one typographic system. */}
            {!Icon && <span aria-hidden className="section-rule" />}
            <h1 className="font-display text-2xl md:text-3xl font-extrabold tracking-tight">{title}</h1>
          </div>
          {description && (
            <p className="text-sm text-muted-foreground mt-1">{description}</p>
          )}
        </div>
      </div>

      {actions && (
        <div className="flex flex-wrap items-center gap-2 sm:shrink-0 [&>*]:flex-1 sm:[&>*]:flex-none">{actions}</div>
      )}
    </header>
  );
}
