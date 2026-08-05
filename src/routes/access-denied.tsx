import { createFileRoute, Link } from "@tanstack/react-router";
import { PulseLogo } from "@/components/PulseLogo";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/access-denied")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "אין הרשאה · Pulse" },
      { name: "description", content: "אין לך הרשאה לצפות בעמוד זה" },
      { property: "og:title", content: "אין הרשאה · Pulse" },
      { property: "og:description", content: "אין לך הרשאה לצפות בעמוד זה" },
    ],
  }),
  component: AccessDenied,
});

function AccessDenied() {
  return (
    <div dir="rtl" className="min-h-dvh flex items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <PulseLogo variant="symbol" className="h-10 mx-auto mb-4" />
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-destructive/10 text-destructive text-2xl">✕</div>
        <h1 className="mt-4 text-2xl font-extrabold tracking-tight">אין הרשאה</h1>
        <p className="mt-2 text-muted-foreground">אין לך הרשאה לצפות בעמוד זה.</p>
        <Button asChild className="mt-6">
          <Link to="/">חזרה לדף הבית</Link>
        </Button>
      </div>
    </div>
  );
}
