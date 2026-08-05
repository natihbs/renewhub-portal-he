import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser, unauthenticated } from "../supabase";

export default defineTool({
  name: "list_goals",
  title: "List monthly goals",
  description:
    "List monthly target goals for teams and representatives that the signed-in user may read. Optionally filter to a single month.",
  inputSchema: {
    goal_month: z
      .string()
      .optional()
      .describe("Month to filter on, as the first day of the month in YYYY-MM-DD form, e.g. 2026-08-01."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ goal_month }, ctx) => {
    if (!ctx.isAuthenticated()) return unauthenticated();
    const supabase = supabaseForUser(ctx);

    let teamQuery = supabase
      .from("team_goals")
      .select("id, team_id, goal_month, target_value, updated_at")
      .order("goal_month", { ascending: false });
    let repQuery = supabase
      .from("representative_goals")
      .select("id, representative_id, goal_month, target_value, updated_at")
      .order("goal_month", { ascending: false });
    if (goal_month) {
      teamQuery = teamQuery.eq("goal_month", goal_month);
      repQuery = repQuery.eq("goal_month", goal_month);
    }

    const [teamRes, repRes] = await Promise.all([teamQuery, repQuery]);
    const error = teamRes.error ?? repRes.error;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    const result = { team_goals: teamRes.data ?? [], representative_goals: repRes.data ?? [] };
    return {
      content: [{ type: "text", text: JSON.stringify(result) }],
      structuredContent: result,
    };
  },
});
