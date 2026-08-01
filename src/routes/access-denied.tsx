import { createFileRoute, Link } from "@tanstack/react-router";
import { PulseLogo } from "@/components/PulseLogo";

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
        <h1 className="mt-4 text-2xl font-bold">אין הרשאה</h1>
        <p className="mt-2 text-muted-foreground">אין לך הרשאה לצפות בעמוד זה.</p>
        <Link to="/" className="mt-6 inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
          חזרה לדף הבית
        </Link>
      </div>
    </div>
  );
}
