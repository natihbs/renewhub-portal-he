/**
 * Shared, dependency-free guard for every server function that accepts a
 * destination team_id for a NEW assignment — a user, a representative, or a
 * login account being placed onto a team. Never applied to removal/
 * unassignment (team_id going to null), which must stay allowed even for an
 * inactive team so existing members can still be cleaned up.
 *
 * "A deactivated team is unavailable for new assignments" is a rule the UI
 * already states (teams.tsx, the active-only assignment pickers in
 * teams-hooks.ts) — this is what actually enforces it server-side, on every
 * path that writes a team_id, not just team-admin.functions.ts's
 * setUserTeam. Kept in its own zero-dependency module so both
 * team-admin.functions.ts and rep-admin.functions.ts (which team-admin
 * already imports from) can share it without a circular import.
 */
export function assertTeamIsActiveForNewAssignment(team: { active: boolean } | null | undefined): void {
  if (!team) throw new Error("הצוות לא נמצא");
  if (!team.active) {
    throw new Error("לא ניתן לשייך לצוות מושבת — יש להפעיל את הצוות מחדש לפני שיוך חדש, או לבחור צוות אחר.");
  }
}

/**
 * A deactivated team keeps every write surface it already had readable
 * (historical targets, past months) but must not silently accept NEW
 * operational writes — team_goals/representative_goals for an inactive team
 * are exactly that (see goals.functions.ts's setTeamGoal/
 * setRepresentativeGoals/copyGoalsFromPreviousMonth). Read paths
 * (getTargetWorkspace, a dry-run preview) are never gated by this — only an
 * actual write is.
 */
export function assertTeamIsActiveForOperationalWrite(team: { active: boolean } | null | undefined): void {
  if (!team) throw new Error("הצוות לא נמצא");
  if (!team.active) {
    throw new Error("הצוות מושבת — לא ניתן לערוך יעדים עבורו. יש להפעיל את הצוות מחדש כדי לבצע שינויים, או לצפות בנתונים ההיסטוריים בלבד.");
  }
}
