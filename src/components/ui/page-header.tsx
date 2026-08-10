import type { ReactNode } from "react";

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    // Phones stack the title above the actions; wide screens keep the single row.
    <header className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
      <div className="min-w-0">
        {/* Same brand rule the dashboard section headings use, so page titles
            and in-page groups read as one typographic system. */}
        <div className="flex items-center gap-2">
          <span aria-hidden className="section-rule" />
          <h1 className="font-display text-2xl md:text-3xl font-extrabold tracking-tight">{title}</h1>
        </div>
        {description && (
          <p className="text-sm text-muted-foreground mt-1">{description}</p>
        )}
      </div>

      {actions && (
        <div className="flex flex-wrap items-center gap-2 sm:shrink-0 [&>*]:flex-1 sm:[&>*]:flex-none">{actions}</div>
      )}
    </header>
  );
}

