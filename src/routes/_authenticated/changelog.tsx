import { createFileRoute, Link } from "@tanstack/react-router";
import { CHANGELOG, APP_NAME, APP_VERSION } from "@/lib/app-meta";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { ArrowRight, CheckCircle2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/changelog")({
  head: () => ({
    meta: [
      { title: `יומן שינויים — ${APP_NAME}` },
      { name: "description", content: `רשימת עדכונים ותכולות עבור ${APP_NAME}.` },
      { property: "og:title", content: `יומן שינויים — ${APP_NAME}` },
      { property: "og:description", content: "היסטוריית עדכונים ותכולות." },
    ],
  }),
  component: ChangelogPage,
});

function ChangelogPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6" dir="rtl">
      <PageHeader
        title="יומן שינויים"
        description={
          <>
            כל התכולות והעדכונים ב-{APP_NAME}. גרסה נוכחית: <span className="font-mono">{APP_VERSION}</span>
          </>
        }
        actions={
          <Button asChild variant="outline" size="sm">
            <Link to="/">
              <ArrowRight className="h-4 w-4" />
              חזרה לדף הבית
            </Link>
          </Button>
        }
      />

      <div className="space-y-4">
        {CHANGELOG.map((entry, idx) => (
          <Card key={entry.version} className="overflow-hidden">
            <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
              <div className="flex items-center gap-2 min-w-0">
                <CardTitle className="text-base truncate">{entry.title}</CardTitle>
                {idx === 0 && <Badge variant="default">נוכחי</Badge>}
              </div>
              <div className="flex items-center gap-2 shrink-0 text-xs text-muted-foreground">
                <span className="font-mono">{entry.version}</span>
                <span>•</span>
                <span>{entry.date}</span>
              </div>
            </CardHeader>
            <CardContent>
              <ul className="space-y-1.5 text-sm">
                {entry.items.map((it, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-success mt-0.5" />
                    <span>{it}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
