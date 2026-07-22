import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { AppProvider } from "@/lib/store";
import { UxProvider } from "@/lib/ux-store";
import { ImportProvider } from "@/lib/import-store";
import { RepWorkspaceProvider } from "@/lib/rep-workspace";
import { MorningProvider } from "@/lib/morning-store";
import { CommsProvider } from "@/lib/comms-store";
import { ListeningProvider } from "@/lib/listening-store";
import { AppModeProvider } from "@/lib/app-mode";
import { IdeasProvider } from "@/lib/ideas-store";

import { RepWorkspace } from "@/components/RepWorkspace";
import { AppShell } from "@/components/layout/AppShell";
import { IdeaFeedbackButton } from "@/components/IdeaFeedback";
import { Toaster } from "@/components/ui/sonner";

function NotFoundComponent() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4" dir="rtl">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">הדף לא נמצא</h2>
        <p className="mt-2 text-sm text-muted-foreground">הדף שחיפשת אינו קיים או הוסר.</p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            חזרה לדף הבית
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4" dir="rtl">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">אירעה שגיאה בטעינת הדף</h1>
        <p className="mt-2 text-sm text-muted-foreground">ניתן לרענן או לחזור לדף הבית.</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            נסה שוב
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground hover:bg-accent"
          >
            לדף הבית
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "RenewHub" },
      { name: "description", content: "מרכז שליטה ניהולי לצוותי החידושים - מצב צוות, התראות, משימות ותובנות בזמן אמת" },
      { property: "og:title", content: "RenewHub" },
      { property: "og:description", content: "מרכז שליטה ניהולי לצוותי החידושים - מצב צוות, התראות, משימות ותובנות בזמן אמת" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "RenewHub" },
      { name: "twitter:description", content: "מרכז שליטה ניהולי לצוותי החידושים - מצב צוות, התראות, משימות ותובנות בזמן אמת" },
      { property: "og:image", content: "https://storage.googleapis.com/gpt-engineer-file-uploads/attachments/og-images/e082c3e3-7434-4fd9-a840-da9206631be8" },
      { name: "twitter:image", content: "https://storage.googleapis.com/gpt-engineer-file-uploads/attachments/og-images/e082c3e3-7434-4fd9-a840-da9206631be8" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Heebo:wght@400;500;600;700;800&display=swap",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="he" dir="rtl">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <AppModeProvider>
        <AppProvider>
          <UxProvider>
            <IdeasProvider>
              <ImportProvider>
                <RepWorkspaceProvider>
                  <MorningProvider>
                    <CommsProvider>
                      <ListeningProvider>
                        <AppShell>
                          <Outlet />
                        </AppShell>
                        <RepWorkspace />
                        <IdeaFeedbackButton />
                        <Toaster position="top-center" richColors />
                      </ListeningProvider>
                    </CommsProvider>
                  </MorningProvider>
                </RepWorkspaceProvider>
              </ImportProvider>
            </IdeasProvider>
          </UxProvider>
        </AppProvider>
      </AppModeProvider>
    </QueryClientProvider>
  );
}
