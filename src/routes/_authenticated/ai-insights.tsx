import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  generatePerformanceInsights,
  generateFeedbackSummary,
  generateGoalRecommendations,
} from "@/lib/ai-insights.functions";
import { BarChart3, Headphones, Target, Sparkles, AlertTriangle, RefreshCw, Lightbulb } from "lucide-react";
import { cn } from "@/lib/utils";
import { useIsManager } from "@/lib/store";
import { friendlyAiInsightError } from "@/lib/ai-insights-domain";
import Markdown from "react-markdown";

export const Route = createFileRoute("/_authenticated/ai-insights")({
  head: () => ({
    meta: [
      { title: "תובנות AI · Pulse" },
      { name: "description", content: "תובנות ביצוע, סיכומי משוב והמלצות יעדים מבוססי בינה מלאכותית" },
      { property: "og:title", content: "תובנות AI · Pulse" },
      { property: "og:description", content: "תובנות ביצוע, סיכומי משוב והמלצות יעדים מבוססי בינה מלאכותית" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AiInsightsPage,
});

type InsightType = "performance" | "feedback" | "goals";
type InsightResult = {
  summary: string;
  keyFindings: { title: string; description: string }[];
  recommendations: { action: string; priority: string; rationale: string }[];
};

type InsightCardDef = {
  id: InsightType;
  label: string;
  description: string;
  icon: typeof BarChart3;
  badge: string;
};

const MANAGER_INSIGHTS: InsightCardDef[] = [
  {
    id: "performance",
    label: "תובנות ביצוע",
    description: "ניתוח מצב הצוותים והנציגים מול היעדים החודשיים",
    icon: BarChart3,
    badge: "ביצועים",
  },
  {
    id: "feedback",
    label: "סיכום משוב והאזנות",
    description: "זיהוי דפוסים חוזרים והמלצות שיפור ממשובי 30 הימים האחרונים",
    icon: Headphones,
    badge: "משוב",
  },
  {
    id: "goals",
    label: "המלצות ליעדים",
    description: "הצעות ליעדים ריאליים לחודש הבא על בסיס ביצוע קודם",
    icon: Target,
    badge: "יעדים",
  },
];

/**
 * The representative's cards, in personal language. Safe to offer because the
 * scope is enforced SERVER-side, not by this copy: the insight functions fetch
 * through the caller's RLS-scoped client, resolve the role from user_roles,
 * and additionally filter both the performance and the feedback prompts to
 * scope.repId for a representative (ai-insights.functions.ts) — so the model
 * never receives another person's rows regardless of what the UI says.
 */
const REP_INSIGHTS: InsightCardDef[] = [
  {
    id: "performance",
    label: "התקדמות מול היעד שלי",
    description: "ניתוח אישי של הביצוע שלך מול היעד החודשי",
    icon: BarChart3,
    badge: "ביצועים",
  },
  {
    id: "feedback",
    label: "מה חוזר במשובים שלי",
    description: "דפוסים חוזרים מהמשובים שפורסמו עבורך ב-30 הימים האחרונים",
    icon: Headphones,
    badge: "משוב",
  },
  {
    id: "goals",
    label: "איך להשתפר לקראת החודש הבא",
    description: "המלצות אישיות על בסיס הביצוע שלך עד כה",
    icon: Target,
    badge: "יעדים",
  },
];

const priorityClass = (p: string) => {
  const normalized = p.toLowerCase();
  if (normalized === "high") return "bg-destructive/10 text-destructive border-destructive/20";
  if (normalized === "medium") return "bg-warning/15 text-warning-foreground border-warning/30";
  return "bg-success/10 text-success-foreground border-success/25";
};

const priorityLabel = (p: string) => {
  const normalized = p.toLowerCase();
  if (normalized === "high") return "גבוהה";
  if (normalized === "medium") return "בינונית";
  return "נמוכה";
};

function AiInsightsPage() {
  const isManager = useIsManager();
  const insightDefs = isManager ? MANAGER_INSIGHTS : REP_INSIGHTS;
  const [activeTab, setActiveTab] = useState<InsightType>("performance");
  const [results, setResults] = useState<Partial<Record<InsightType, InsightResult>>>({});
  const [loading, setLoading] = useState<Partial<Record<InsightType, boolean>>>({});
  const [errors, setErrors] = useState<Partial<Record<InsightType, string>>>({});

  const performanceFn = useServerFn(generatePerformanceInsights);
  const feedbackFn = useServerFn(generateFeedbackSummary);
  const goalsFn = useServerFn(generateGoalRecommendations);

  const generate = async (type: InsightType) => {
    if (loading[type]) return;
    setLoading((prev) => ({ ...prev, [type]: true }));
    setErrors((prev) => ({ ...prev, [type]: undefined }));
    try {
      const result =
        type === "performance"
          ? await performanceFn({ data: undefined })
          : type === "feedback"
            ? await feedbackFn({ data: undefined })
            : await goalsFn({ data: undefined });
      setResults((prev) => ({ ...prev, [type]: result as InsightResult }));
    } catch (e) {
      // Raw provider/SDK text (English) goes to the console only; the user
      // sees our Hebrew messages, or the calm generic line.
      console.error("[ai-insights] generation failed", e);
      setErrors((prev) => ({ ...prev, [type]: friendlyAiInsightError(e) }));
    } finally {
      setLoading((prev) => ({ ...prev, [type]: false }));
    }
  };

  return (
    <div className="space-y-6" dir="rtl">
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-primary" />
          <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight">
            {isManager ? "תובנות AI" : "התובנות שלי"}
          </h1>
        </div>
        <p className="text-sm text-muted-foreground">
          {isManager
            ? "ניתוח מבוסס בינה מלאכותית של נתוני הביצוע, המשוב והיעדים — מותאם לתפקיד שלך במערכת."
            : "ניתוח אישי מבוסס בינה מלאכותית של ההתקדמות והמשובים שלך."}
        </p>
        {!isManager && (
          <p className="text-xs text-muted-foreground">
            התובנות מבוססות על הנתונים האישיים שלך בלבד.
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {insightDefs.map((insight) => {
          const Icon = insight.icon;
          const isLoading = !!loading[insight.id];
          const hasResult = !!results[insight.id];
          return (
            <Card
              key={insight.id}
              className={cn(
                "card-interactive cursor-pointer",
                activeTab === insight.id && "border-primary/40 bg-primary/[0.03]",
              )}
              onClick={() => setActiveTab(insight.id)}
            >
              <CardHeader className="pb-3">
                {/* Mobile/RTL safety: long Hebrew labels must wrap, never
                    overlap the badge or clip — min-w-0 lets the flex child
                    shrink, break-words wraps the label, the badge never
                    shrinks. Desktop rendering is unchanged (wrapping only
                    engages when there is no room). */}
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <div className="shrink-0 rounded-lg bg-primary/10 p-2">
                      <Icon className="h-5 w-5 text-primary" />
                    </div>
                    <CardTitle className="min-w-0 break-words text-base">{insight.label}</CardTitle>
                  </div>
                  <Badge variant="outline" className="shrink-0">
                    {insight.badge}
                  </Badge>
                </div>
                <CardDescription className="text-xs leading-5 pt-1 break-words">
                  {insight.description}
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                <Button
                  size="sm"
                  className="w-full"
                  disabled={isLoading}
                  onClick={(e) => {
                    e.stopPropagation();
                    void generate(insight.id);
                  }}
                >
                  {isLoading ? (
                    <>
                      <RefreshCw className="ms-1 h-4 w-4 animate-spin" />
                      מנתח…
                    </>
                  ) : hasResult ? (
                    <>
                      <RefreshCw className="ms-1 h-4 w-4" />
                      נתח שוב
                    </>
                  ) : (
                    <>
                      <Sparkles className="ms-1 h-4 w-4" />
                      צור תובנה
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as InsightType)} className="w-full">
        {/* A fixed 3-column grid clipped/overlapped the long Hebrew tab
            labels on narrow screens — same wrap-instead-of-clip pattern as
            the feedback page's tab bar. */}
        <TabsList className="flex h-auto w-full flex-wrap justify-start md:w-auto">
          {insightDefs.map((i) => (
            <TabsTrigger key={i.id} value={i.id} className="whitespace-normal">
              {i.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {insightDefs.map((insight) => (
          <TabsContent key={insight.id} value={insight.id} className="mt-4">
            <InsightPanel
              result={results[insight.id]}
              loading={!!loading[insight.id]}
              error={errors[insight.id]}
              onRetry={() => generate(insight.id)}
            />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

function InsightPanel({
  result,
  loading,
  error,
  onRetry,
}: {
  result?: InsightResult;
  loading: boolean;
  error?: string;
  onRetry: () => void;
}) {
  if (loading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-72" />
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>שגיאה ביצירת התובנה</AlertTitle>
        <AlertDescription className="flex flex-col gap-3">
          <span>{error}</span>
          <Button size="sm" variant="outline" onClick={onRetry} className="w-fit">
            <RefreshCw className="ms-1 h-4 w-4" />
            נסה שוב
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  if (!result) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center justify-center py-12 text-center">
          <Lightbulb className="h-10 w-10 text-muted-foreground/60 mb-3" />
          <p className="text-sm font-medium text-muted-foreground">עדיין אין תובנה</p>
          <p className="text-xs text-muted-foreground mt-1">לחץ על "צור תובנה" בכרטיסייה המתאימה כדי להתחיל.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">סיכום</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="markdown-content text-sm text-foreground">
            <Markdown>{result.summary}</Markdown>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">ממצאים עיקריים</CardTitle>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-auto max-h-[400px] pr-3">
            <ul className="space-y-3">
              {result.keyFindings.map((finding, idx) => (
                <li key={idx} className="rounded-lg border p-3">
                  <div className="flex items-start gap-2">
                    <Badge variant="secondary" className="shrink-0 mt-0.5">
                      {idx + 1}
                    </Badge>
                    <div className="space-y-1">
                      <p className="font-medium text-sm">{finding.title}</p>
                      <p className="text-sm text-muted-foreground leading-relaxed">{finding.description}</p>
                    </div>
                  </div>
                </li>
              ))}
              {result.keyFindings.length === 0 && (
                <p className="text-sm text-muted-foreground">לא זוהו ממצאים עיקריים.</p>
              )}
            </ul>
          </ScrollArea>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">המלצות</CardTitle>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-auto max-h-[400px] pr-3">
            <ul className="space-y-3">
              {result.recommendations.map((rec, idx) => (
                <li key={idx} className="rounded-lg border p-3">
                  <div className="flex flex-wrap items-start gap-2">
                    <Badge className={cn("shrink-0", priorityClass(rec.priority))}>{priorityLabel(rec.priority)}</Badge>
                    <div className="flex-1 min-w-0 space-y-1">
                      <p className="font-medium text-sm">{rec.action}</p>
                      <p className="text-sm text-muted-foreground leading-relaxed">{rec.rationale}</p>
                    </div>
                  </div>
                </li>
              ))}
              {result.recommendations.length === 0 && (
                <p className="text-sm text-muted-foreground">לא הופקו המלצות.</p>
              )}
            </ul>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
