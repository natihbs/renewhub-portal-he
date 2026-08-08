import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { generateText, Output, NoObjectGeneratedError } from "ai";
import {
  AI_INSIGHT_FRIENDLY_ERROR,
  NO_DATA_INSIGHT,
  normalizeInsightResult,
  parseInsightFallback,
  type InsightResultShape,
} from "@/lib/ai-insights-domain";
import { z } from "zod";
import { createLovableAiGatewayProvider } from "@/lib/ai-gateway.server";
import { currentMonthStart } from "@/lib/kpi-values";

type Ctx = { supabase: any; userId: string; claims: any };
type AppRole = "admin" | "manager" | "representative";

async function getRoles(ctx: Ctx): Promise<AppRole[]> {
  const { data, error } = await ctx.supabase.from("user_roles").select("role").eq("user_id", ctx.userId);
  if (error) throw new Error("שגיאה באימות הרשאות");
  return ((data ?? []) as { role: string }[]).map((r) => r.role as AppRole);
}

async function getScope(ctx: Ctx): Promise<{
  role: AppRole;
  teamIds: string[];
  repId: string | null;
}> {
  const roles = await getRoles(ctx);
  const role: AppRole = roles.includes("admin")
    ? "admin"
    : roles.includes("manager")
      ? "manager"
      : "representative";

  let teamIds: string[] = [];
  let repId: string | null = null;

  const { data: profile } = await ctx.supabase
    .from("profiles")
    .select("team_id, representative_id")
    .eq("id", ctx.userId)
    .maybeSingle();

  if (role === "admin") {
    const { data: teams } = await ctx.supabase.from("teams").select("id");
    teamIds = ((teams ?? []) as { id: string }[]).map((t) => t.id);
  } else if (role === "manager") {
    const { data: teams } = await ctx.supabase.from("teams").select("id").eq("manager_id", ctx.userId);
    teamIds = ((teams ?? []) as { id: string }[]).map((t) => t.id);
  } else if (profile?.team_id) {
    teamIds = [profile.team_id];
  }

  const { data: rep } = await ctx.supabase
    .from("representatives")
    .select("id")
    .eq("user_id", ctx.userId)
    .maybeSingle();
  repId = (rep as { id: string } | null)?.id ?? profile?.representative_id ?? null;

  return { role, teamIds, repId };
}

async function fetchPerformanceContext(ctx: Ctx, scope: { role: AppRole; teamIds: string[]; repId: string | null }) {
  const month = currentMonthStart();

  const [{ data: teams }, { data: reps }, { data: teamGoals }, { data: repGoals }, { data: kpiValues }] = await Promise.all([
    ctx.supabase.from("teams").select("id, name, manager_id, active, kpi_profile"),
    ctx.supabase.from("representatives").select("id, name, team_id, user_id, current_result, active"),
    ctx.supabase.from("team_goals").select("team_id, goal_month, target_value").eq("goal_month", month),
    ctx.supabase.from("representative_goals").select("representative_id, goal_month, target_value").eq("goal_month", month),
    ctx.supabase.from("kpi_values").select("representative_id, team_id, kind, value, period").eq("period", month),
  ]);

  return {
    month,
    teams: teams ?? [],
    reps: reps ?? [],
    teamGoals: teamGoals ?? [],
    repGoals: repGoals ?? [],
    kpiValues: kpiValues ?? [],
    scope,
  };
}

async function fetchFeedbackContext(ctx: Ctx, scope: { role: AppRole; teamIds: string[]; repId: string | null }) {
  const since = new Date();
  since.setDate(since.getDate() - 30);
  const sinceDate = since.toISOString().slice(0, 10);

  let q = ctx.supabase
    .from("feedback")
    .select("id, representative_id, feedback_date, call_id, score, keep_doing, improve, manager_summary, next_task, published")
    .gte("feedback_date", sinceDate)
    .order("feedback_date", { ascending: false })
    .limit(100);

  if (scope.role === "representative" && scope.repId) {
    q = q.eq("representative_id", scope.repId);
  }

  const { data: feedback, error } = await q;
  if (error) throw new Error(error.message);

  const repIds = [...new Set((feedback ?? []).map((f: any) => f.representative_id))];
  const { data: reps } = await ctx.supabase.from("representatives").select("id, name, team_id").in("id", repIds.length ? repIds : ["00000000-0000-0000-0000-000000000000"]);

  return {
    since: sinceDate,
    feedback: feedback ?? [],
    reps: reps ?? [],
    scope,
  };
}

const InsightSchema = z.object({
  summary: z.string(),
  keyFindings: z.array(
    z.object({
      title: z.string(),
      description: z.string(),
    }),
  ),
  recommendations: z.array(
    z.object({
      action: z.string(),
      priority: z.string(),
      rationale: z.string(),
    }),
  ),
});

/**
 * The JSON contract, repeated inside the USER prompt so the required English
 * key names reach the model even if the gateway's instructions handling ever
 * changes — the blank-insight incident showed the format spec must not live
 * in one delivery channel only. Content stays Hebrew; keys stay English.
 */
export const PROMPT_JSON_CONTRACT = [
  "החזר JSON בלבד, עם שמות המפתחות באנגלית בדיוק כפי שמופיעים כאן (התוכן עצמו בעברית):",
  '{"summary": "סיכום קצר", "keyFindings": [{"title": "כותרת", "description": "תיאור"}], "recommendations": [{"action": "פעולה", "priority": "high|medium|low", "rationale": "נימוק"}]}',
  "אל תחזיר מפתחות בעברית ואל תוסיף טקסט מחוץ ל-JSON.",
];

/**
 * Post-generation quality gate + honest routing:
 *  - a usable result (normalizeInsightResult) is returned as-is;
 *  - an empty/unusable "success" over a scope that HAD data throws the
 *    friendly retryable error — telling that user "אין נתונים" would be false;
 *  - an empty result over a scope with genuinely nothing to analyze returns
 *    the deliberate NO_DATA_INSIGHT content instead of blank cards.
 */
async function generateInsight(
  prompt: string,
  instructions: string,
  hasData: boolean,
): Promise<InsightResultShape> {
  const key = process.env["LOVABLE_API_KEY"];
  if (!key) {
    // Configuration detail stays in server logs; the user gets the calm line.
    console.error("[ai-insights] LOVABLE_API_KEY is not configured");
    throw new Error(AI_INSIGHT_FRIENDLY_ERROR);
  }

  // structuredOutputs: strict json_schema instead of best-effort json_object —
  // the gateway provider helper exposes exactly this switch, and it is what
  // makes the model emit the English schema keys instead of improvised ones.
  // The zod schema itself stays keyword-minimal (no minLength/minItems):
  // strict validators reject unsupported keywords, so non-emptiness is
  // enforced right below by normalizeInsightResult instead of on the wire.
  const gateway = createLovableAiGatewayProvider(key, undefined, { structuredOutputs: true });
  const model = gateway("google/gemini-3.6-flash");

  try {
    const { output } = await generateText({
      model,
      // USER content only. The Lovable gateway rejects a system-role entry
      // inside prompt/messages ("Invalid prompt: System messages are not
      // allowed in the prompt or messages fields. Use the instructions
      // option instead."), so nothing here ever carries a system message.
      prompt,
      // System-level guidance travels as the gateway's `instructions` body
      // field: the openai-compatible provider (name: "lovable" in
      // ai-gateway.server.ts) merges its per-provider options straight into
      // the request body.
      providerOptions: { lovable: { instructions } },
      output: Output.object({ schema: InsightSchema }),
    });
    const usable = normalizeInsightResult(output);
    if (usable) return usable;
    console.error("[ai-insights] model returned an empty/unusable insight object", output);
    if (!hasData) return NO_DATA_INSIGHT;
    throw new Error(AI_INSIGHT_FRIENDLY_ERROR);
  } catch (error) {
    if (error instanceof Error && error.message === AI_INSIGHT_FRIENDLY_ERROR) throw error;
    if (NoObjectGeneratedError.isInstance(error)) {
      const fallback = parseInsightFallback(error.text);
      if (fallback) return fallback;
      if (!hasData) return NO_DATA_INSIGHT;
    }
    // Full technical detail server-side only — the user never sees raw
    // English provider text as their main message.
    console.error("[ai-insights] generation failed", error);
    throw new Error(AI_INSIGHT_FRIENDLY_ERROR);
  }
}

function formatPerformancePrompt(ctx: Awaited<ReturnType<typeof fetchPerformanceContext>>): {
  prompt: string;
  hasData: boolean;
} {
  const { month, teams, reps, teamGoals, repGoals, kpiValues, scope } = ctx;
  const visibleTeams = scope.role === "admin" ? teams : teams.filter((t: any) => scope.teamIds.includes(t.id));
  const visibleReps = scope.role === "representative" && scope.repId
    ? reps.filter((r: any) => r.id === scope.repId)
    : scope.role === "manager"
      ? reps.filter((r: any) => scope.teamIds.includes(r.team_id))
      : reps;

  const rows = visibleReps.map((r: any) => {
    const team = visibleTeams.find((t: any) => t.id === r.team_id);
    const goal = repGoals.find((g: any) => g.representative_id === r.id)?.target_value ?? null;
    const achievement = goal && goal > 0 ? Math.round((r.current_result / goal) * 100) : null;
    return {
      name: r.name,
      team: team?.name ?? "ללא צוות",
      active: r.active,
      currentResult: r.current_result,
      goal,
      achievement,
    };
  });

  const teamRows = visibleTeams.map((t: any) => {
    const goal = teamGoals.find((g: any) => g.team_id === t.id)?.target_value ?? null;
    const teamReps = visibleReps.filter((r: any) => r.team_id === t.id);
    const totalResult = teamReps.reduce((sum: number, r: any) => sum + (r.current_result ?? 0), 0);
    const achievement = goal && goal > 0 ? Math.round((totalResult / goal) * 100) : null;
    return { name: t.name, active: t.active, totalResult, goal, achievement, repCount: teamReps.length };
  });

  const prompt = [
    "נתוני ביצוע לחודש " + month,
    "תפקיד הצופה: " + (scope.role === "admin" ? "מנהל מערכת" : scope.role === "manager" ? "מנהל צוות" : "נציג"),
    "",
    "צוותים:",
    ...teamRows.map((t: { name: string; active: boolean; repCount: number; totalResult: number; goal: number | null; achievement: number | null }) =>
      `- ${t.name} | פעיל: ${t.active ? "כן" : "לא"} | נציגים: ${t.repCount} | ביצוע: ${t.totalResult} | יעד: ${t.goal ?? "לא הוגדר"} | אחוז: ${t.achievement ?? "N/A"}%`
    ),
    "",
    "נציגים:",
    ...rows.map((r: { name: string; team: string; active: boolean; currentResult: number; goal: number | null; achievement: number | null }) =>
      `- ${r.name} (${r.team}) | פעיל: ${r.active ? "כן" : "לא"} | ביצוע: ${r.currentResult} | יעד אישי: ${r.goal ?? "לא הוגדר"} | אחוז: ${r.achievement ?? "N/A"}%`
    ),
    ...(scope.role === "representative"
      ? [
          "",
          "הצופה הוא נציג: נתח את ההתקדמות האישית שלו מול היעד — אחוז עמידה, פער ליעד וקצב נדרש, ככל שהנתונים מאפשרים.",
        ]
      : []),
    "",
    "הנחה אתי: אם אין מספיק נתונים, ציין זאת במפורש בעברית והצע צעד מעשי אחד להמשך. אל תמציא נתונים או שמות שלא הוצגו.",
    "",
    ...PROMPT_JSON_CONTRACT,
  ].join("\n");
  return { prompt, hasData: rows.length > 0 };
}

function formatFeedbackPrompt(ctx: Awaited<ReturnType<typeof fetchFeedbackContext>>): {
  prompt: string;
  hasData: boolean;
} {
  const { since, feedback, reps, scope } = ctx;
  const visibleFeedback = scope.role === "representative" && scope.repId
    ? feedback.filter((f: any) => f.representative_id === scope.repId)
    : feedback;

  const byRep = new Map<string, typeof visibleFeedback>();
  for (const f of visibleFeedback) {
    const arr = byRep.get(f.representative_id) ?? [];
    arr.push(f);
    byRep.set(f.representative_id, arr);
  }

  const lines = [
    `סיכום משוב והאזנות מאז ${since}`,
    "תפקיד הצופה: " + (scope.role === "admin" ? "מנהל מערכת" : scope.role === "manager" ? "מנהל צוות" : "נציג"),
    `סה"כ רשומות: ${visibleFeedback.length}`,
    "",
  ];

  for (const [repId, items] of byRep.entries()) {
    const rep = reps.find((r: any) => r.id === repId);
    const avg = items.length ? (items.reduce((s: number, f: any) => s + (f.score ?? 0), 0) / items.length).toFixed(1) : "N/A";
    lines.push(`נציג: ${rep?.name ?? "לא ידוע"} | ממוצע ציון: ${avg} | מספר משובים: ${items.length}`);
    for (const f of items.slice(0, 5)) {
      lines.push(`  - תאריך ${f.feedback_date} | ציון ${f.score ?? "N/A"}`);
      if (f.keep_doing) lines.push(`    המשך לעשות: ${f.keep_doing.slice(0, 120)}`);
      if (f.improve) lines.push(`    שפר: ${f.improve.slice(0, 120)}`);
      if (f.manager_summary) lines.push(`    סיכום מנהל: ${f.manager_summary.slice(0, 120)}`);
    }
  }

  if (scope.role === "representative") {
    lines.push(
      "",
      "הצופה הוא נציג: סכם את הדפוסים החוזרים במשובים שפורסמו עבורו — מה עובד ומה לשפר.",
    );
  }
  lines.push(
    "",
    "הנחה אתי: אם אין מספיק נתונים, ציין זאת במפורש בעברית והצע צעד מעשי אחד להמשך. אל תמציא נתונים או שמות שלא הוצגו.",
    "",
    ...PROMPT_JSON_CONTRACT,
  );
  return { prompt: lines.join("\n"), hasData: visibleFeedback.length > 0 };
}

function formatGoalsPrompt(ctx: Awaited<ReturnType<typeof fetchPerformanceContext>>): {
  prompt: string;
  hasData: boolean;
} {
  const { month, teams, reps, teamGoals, repGoals, scope } = ctx;
  const visibleTeams = scope.role === "admin" ? teams : teams.filter((t: any) => scope.teamIds.includes(t.id));
  const visibleReps = scope.role === "representative" && scope.repId
    ? reps.filter((r: any) => r.id === scope.repId)
    : scope.role === "manager"
      ? reps.filter((r: any) => scope.teamIds.includes(r.team_id))
      : reps;

  const lines = [
    "המלצות ליעדים לחודש " + month,
    "תפקיד הצופה: " + (scope.role === "admin" ? "מנהל מערכת" : scope.role === "manager" ? "מנהל צוות" : "נציג"),
    "",
    "יעדי צוותים:",
    ...visibleTeams.map((t: any) => {
      const goal = teamGoals.find((g: any) => g.team_id === t.id)?.target_value ?? null;
      const teamReps = visibleReps.filter((r: any) => r.team_id === t.id);
      const totalResult = teamReps.reduce((sum: number, r: any) => sum + (r.current_result ?? 0), 0);
      return `- ${t.name} | יעד נוכחי: ${goal ?? "לא הוגדר"} | ביצוע עד כה: ${totalResult}`;
    }),
    "",
    "יעדי נציגים:",
    ...visibleReps.map((r: any) => {
      const goal = repGoals.find((g: any) => g.representative_id === r.id)?.target_value ?? null;
      return `- ${r.name} | יעד נוכחי: ${goal ?? "לא הוגדר"} | ביצוע עד כה: ${r.current_result ?? 0}`;
    }),
    ...(scope.role === "representative"
      ? [
          "",
          "הצופה הוא נציג: תן 1-3 המלצות מעשיות לשיפור לקראת החודש הבא, על בסיס הנתונים האישיים שלו בלבד.",
        ]
      : []),
    "",
    "הנחה אתי: אם אין מספיק נתונים, ציין זאת במפורש בעברית והצע צעד מעשי אחד להמשך. אל תמציא נתונים או שמות שלא הוצגו.",
    "",
    ...PROMPT_JSON_CONTRACT,
  ];
  return { prompt: lines.join("\n"), hasData: visibleReps.length > 0 };
}

const SYSTEM_PERFORMANCE = `אתה עוזר AI למערכת ניהול צוותי מכירות (Pulse/RenewHub). תפקידך לנתח נתוני ביצוע ולהפיק תובנות מעשיות בעברית.

הפלט חייב להיות JSON עם המבנה הבא:
- summary: סיכום קצר (עד 2 משפטים) של מצב הביצוע.
- keyFindings: מערך של 2-5 ממצאים עיקריים, כל אחד עם title ו-description.
- recommendations: מערך של 2-5 המלצות מעשיות, כל אחת עם action, priority (high/medium/low), ו-rationale.

כללים:
- כתוב בעברית בלבד.
- התמקד בדברים שהנתונים מראים בפועל — אל תמציא נתונים.
- אם אין מספיק נתונים, ציין זאת בכנות.
- היו מכבדים ומעודדים; הימנע משפיטות אישיות קשות.`;

const SYSTEM_FEEDBACK = `אתה עוזר AI למערכת ניהול צוותי מכירות (Pulse/RenewHub). תפקידך לסכם משובי האזנות ולהפיק תובנות מעשיות בעברית.

הפלט חייב להיות JSON עם המבנה הבא:
- summary: סיכום קצר (עד 2 משפטים) של מצב המשוב.
- keyFindings: מערך של 2-5 ממצאים עיקריים, כל אחד עם title ו-description.
- recommendations: מערך של 2-5 המלצות מעשיות, כל אחת עם action, priority (high/medium/low), ו-rationale.

כללים:
- כתוב בעברית בלבד.
- התמקד בדפוסים חוזרים ובנקודות לשיפור שמופיעות בנתונים.
- אין להחשיף פרטים אישיים רגישים מעבר לשם הנציג.
- אם אין מספיק נתונים, ציין זאת בכנות.`;

const SYSTEM_GOALS = `אתה עוזר AI למערכת ניהול צוותי מכירות (Pulse/RenewHub). תפקידך להמליץ על יעדים חודשיים ריאליים על בסיס ביצוע קודם ומגמות בעברית.

הפלט חייב להיות JSON עם המבנה הבא:
- summary: סיכום קצר (עד 2 משפטים) של המלצתך.
- keyFindings: מערך של 2-5 ממצאים עיקריים, כל אחד עם title ו-description.
- recommendations: מערך של 2-5 המלצות ליעדים, כל אחת עם action (תיאור היעד המוצע), priority (high/medium/low), ו-rationale.

כללים:
- כתוב בעברית בלבד.
- הצע יעדים ספציפיים ומספריים ככל האפשר, מבוססים על הנתונים.
- קח בחשבון את הביצוע הנוכחי ואת הזמן שנותר בחודש.
- אם אין מספיק נתונים היסטוריים, ציין זאת בכנות.`;

export const generatePerformanceInsights = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const scope = await getScope(context as any);
    const ctx = await fetchPerformanceContext(context as any, scope);
    const { prompt, hasData } = formatPerformancePrompt(ctx);
    const result = await generateInsight(prompt, SYSTEM_PERFORMANCE, hasData);
    return result;
  });

export const generateFeedbackSummary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const scope = await getScope(context as any);
    const ctx = await fetchFeedbackContext(context as any, scope);
    const { prompt, hasData } = formatFeedbackPrompt(ctx);
    const result = await generateInsight(prompt, SYSTEM_FEEDBACK, hasData);
    return result;
  });

export const generateGoalRecommendations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const scope = await getScope(context as any);
    const ctx = await fetchPerformanceContext(context as any, scope);
    const { prompt, hasData } = formatGoalsPrompt(ctx);
    const result = await generateInsight(prompt, SYSTEM_GOALS, hasData);
    return result;
  });
