import { auth, defineMcp } from "@lovable.dev/mcp-js";
import whoamiTool from "./tools/whoami";
import listTeamsTool from "./tools/list-teams";
import listRepresentativesTool from "./tools/list-representatives";
import listGoalsTool from "./tools/list-goals";
import setRepresentativeGoalTool from "./tools/set-representative-goal";

// The OAuth issuer must be the direct Supabase host; the project ref is the only
// value that survives publish unchanged.
const projectRef = import.meta.env['VITE_SUPABASE_PROJECT_ID'] ?? "project-ref-unset";

export default defineMcp({
  name: "remix-of-renewhub-dashboard",
  title: "Remix of RenewHub Dashboard",
  version: "0.1.0",
  instructions:
    "Tools for the RenewHub sales dashboard. Use `whoami` to see the signed-in user's roles, `list_teams` and `list_representatives` to explore the org, `list_goals` to read monthly targets, and `set_representative_goal` to set a representative's monthly target (admins and managers only). All access is scoped by the app's row-level security.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [whoamiTool, listTeamsTool, listRepresentativesTool, listGoalsTool, setRepresentativeGoalTool],
});
