import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser, unauthenticated } from "../supabase";

export default defineTool({
  name: "list_representatives",
  title: "List representatives",
  description:
    "List sales representatives visible to the signed-in user, with their monthly target and current result. Optionally filter by team.",
  inputSchema: {
    team_id: z.string().uuid().optional().describe("Only return representatives on this team."),
    include_inactive: z.boolean().optional().describe("Include deactivated representatives (default false)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ team_id, include_inactive }, ctx) => {
    if (!ctx.isAuthenticated()) return unauthenticated();
    const supabase = supabaseForUser(ctx);
    let query = supabase
      .from("representatives")
      .select("id, name, team_id, monthly_target, current_result, active, updated_at")
      .order("name");
    if (team_id) query = query.eq("team_id", team_id);
    if (!include_inactive) query = query.eq("active", true);
    const { data, error } = await query;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data) }],
      structuredContent: { representatives: data ?? [] },
    };
  },
});
