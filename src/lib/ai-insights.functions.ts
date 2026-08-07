import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { generateText, Output, NoObjectGeneratedError } from "ai";
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

type InsightOutput = z.infer<typeof InsightSchema>;

async function generateInsight(
  prompt: string,
  system: string,
): Promise<InsightOutput> {
  const key = process.env["LOVABLE_API_KEY"];
  if (!key) throw new Error("Missing LOVABLE_API_KEY");

  const gateway = createLovableAiGatewayProvider(key);
  const model = gateway("google/gemini-3.6-flash");

  try {
    const { output } = await generateText({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ],
      output: Output.object({ schema: InsightSchema }),
    });
    return output;
  } catch (error) {
    if (NoObjectGeneratedError.isInstance(error)) {
      const fallback = parseFallback(error.text);
      if (fallback) return fallback;
    }
    throw error;
  }
}

function parseFallback(text: string | undefined): InsightOutput | null {
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object") {
      return {
        summary: String(parsed.summary ?? parsed.overview ?? ""),
        keyFindings: Array.isArray(parsed.keyFindings) ? parsed.keyFindings.map((f: any) => ({ title: String(f.title ?? ""), description: String(f.description ?? "") })) : [],
        recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations.map((r: any) => ({ action: String(r.action ?? ""), priority: String(r.priority ?? "medium"), rationale: String(r.rationale ?? "") })) : [],
      };
    }
  } catch {
    // ignore
  }
  return {
    summary: text.slice(0, 500),
    keyFindings: [],
    recommendations: [],
  };
}

function formatPerformancePrompt(ctx: Awaited<ReturnType<typeof fetchPerformanceContext>>): string {
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

  return [
    "נתוני ביצוע לחודש " + month,
    "תפקיד הצופה: " + (scope.role === "admin" ? "מנהל מערכת" : scope.role === "manager" ? "מנהל צוות" : "נציג"),
    "",
    "צוותים:",
    ...teamRows.map((t) => `- ${t.name} | פעיל: ${t.active ? "כן" : "לא"} | נציגים: ${t.repCount} | ביצוע: ${t.totalResult} | יעד: ${t.goal ?? "לא הוגדר"} | אחוז: ${t.achievement ?? "N/A"}%`),
    "",
    "נציגים:",
    ...rows.map((r) => `- ${r.name} (${r.team}) | פעיל: ${r.active ? "כן" : "לא"} | ביצוע: ${r.currentResult} | יעד אישי: ${r.goal ?? "לא הוגדר"} | אחוז: ${r.achievement ?? "N/A"}%`),
    "",
    "הנחה אתי: אם אין מספיק נתונים, ציין זאת במפורש. אל תמציא נתונים או שמות שלא הוצגו.",
  ].join("\n");
}

function formatFeedbackPrompt(ctx: Awaited<ReturnType<typeof fetchFeedbackContext>>): string {
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

  lines.push("", "הנחה אתי: אם אין מספיק נתונים, ציין זאת במפורש. אל תמציא נתונים או שמות שלא הוצגו.");
  return lines.join("\n");
}

function formatGoalsPrompt(ctx: Awaited<ReturnType<typeof fetchPerformanceContext>>): string {
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
    "",
    "הנחה אתי: אם אין מספיק נתונים, ציין זאת במפורש. אל תמציא נתונים או שמות שלא הוצגו.",
  ];
  return lines.join("\n");
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
    const prompt = formatPerformancePrompt(ctx);
    const result = await generateInsight(prompt, SYSTEM_PERFORMANCE);
    return result;
  });

export const generateFeedbackSummary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const scope = await getScope(context as any);
    const ctx = await fetchFeedbackContext(context as any, scope);
    const prompt = formatFeedbackPrompt(ctx);
    const result = await generateInsight(prompt, SYSTEM_FEEDBACK);
    return result;
  });

export const generateGoalRecommendations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const scope = await getScope(context as any);
    const ctx = await fetchPerformanceContext(context as any, scope);
    const prompt = formatGoalsPrompt(ctx);
    const result = await generateInsight(prompt, SYSTEM_GOALS);
    return result;
  });
