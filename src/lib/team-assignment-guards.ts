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
 * Correction (post-review, PR #19): whether a submitted team_id is an actual
 * NEW assignment that assertTeamIsActiveForNewAssignment should gate — never
 * true for a resubmission of the entity's current team_id, and never true for
 * `undefined` (the field wasn't part of this edit at all) or `null` (removal,
 * always allowed). updateUser previously gated on `if (profileUpdate.team_id)`
 * alone, which fired even when an edit form resubmitted a user's unchanged
 * (and possibly inactive) team_id alongside an unrelated field change —
 * blocking a rename with an error about team assignment. The rule an entity's
 * OWN existing team_id, active or not, must remain fully manageable (rename,
 * activate/deactivate, remove, or transfer OUT to an active team) — only a
 * transfer INTO a different, inactive team is ever rejected.
 */
export function isNewTeamAssignment(currentTeamId: string | null, submittedTeamId: string | null | undefined): submittedTeamId is string {
  return submittedTeamId !== undefined && submittedTeamId !== null && submittedTeamId !== currentTeamId;
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
