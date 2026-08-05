import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser, unauthenticated } from "../supabase";

export default defineTool({
  name: "set_representative_goal",
  title: "Set a representative's monthly goal",
  description:
    "Create or update the monthly target for one representative. Only admins and the representative's manager are permitted; representatives cannot write targets.",
  inputSchema: {
    representative_id: z.string().uuid().describe("The representative the goal belongs to."),
    goal_month: z.string().describe("First day of the goal month in YYYY-MM-DD form, e.g. 2026-08-01."),
    target_value: z.number().int().nonnegative().describe("Monthly target value (must be zero or more)."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  handler: async ({ representative_id, goal_month, target_value }, ctx) => {
    if (!ctx.isAuthenticated()) return unauthenticated();
    const supabase = supabaseForUser(ctx);
    const userId = ctx.getUserId();
    const { data, error } = await supabase
      .from("representative_goals")
      .upsert(
        {
          representative_id,
          goal_month,
          target_value,
          created_by: userId,
          updated_by: userId,
        },
        { onConflict: "representative_id,goal_month" },
      )
      .select();
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data) }],
      structuredContent: { goal: data?.[0] ?? null },
    };
  },
});
