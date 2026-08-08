// Pure, testable "User Health Status" calculation for User Management 2.0.
// Consumed both server-side (listUsers/getUserDetails, so the client never
// has to re-derive it from raw rows) and by tests. No side effects, no I/O.

export type UserHealthStatus = "healthy" | "attention" | "issue";

export type UserHealthLinkedRep = {
  active: boolean;
  team_id: string | null;
};

export type UserHealthInput = {
  roles: string[];
  team_id: string | null;
  representative_link: UserHealthLinkedRep | null;
  /**
   * Teams whose teams.manager_id IS this user — actual managerial ownership,
   * as opposed to profiles.team_id which is mere profile membership. Optional
   * because some callers cannot cheaply know it; when omitted the manager
   * checks are skipped rather than guessed.
   */
  managed_team_ids?: string[];
  /**
   * True when the user holds a business-scope grant (user_business_scopes:
   * מוקד / פעילות / סמנכ"ל). A scoped manager has real managerial reach with
   * no profiles.team_id and no direct teams.manager_id rows — that setup is
   * VALID, not incomplete. Counted only for role=manager: a representative
   * or admin with a stray grant gains nothing from it here (mirroring the
   * PR #41 is_manager guard at the SQL funnel).
   */
  has_business_scope?: boolean;
};

export type UserHealth = {
  status: UserHealthStatus;
  emoji: "🟢" | "🟠" | "🔴";
  label: string;
  reasons: string[];
};

const STATUS_META: Record<UserHealthStatus, { emoji: UserHealth["emoji"]; label: string }> = {
  healthy: { emoji: "🟢", label: "תקין" },
  attention: { emoji: "🟠", label: "דורש תשומת לב" },
  issue: { emoji: "🔴", label: "בעיית הגדרה" },
};

/**
 * 🔴 Configuration issue — invalid linkage, conflicting role, or inconsistent
 * assignment. Checked first: these are structural problems, not just gaps.
 * 🟠 Needs attention — no representative linked (for a representative-role
 * user), no assigned team, or another incomplete-setup gap.
 * 🟢 Healthy — everything else: valid role, valid team, and (for
 * representatives) a real linked representative record.
 */
export function computeUserHealth(input: UserHealthInput): UserHealth {
  const isRepresentative = input.roles.includes("representative");
  const link = input.representative_link;

  const issues: string[] = [];
  if (input.roles.length > 1) {
    issues.push("שיוך תפקידים סותר — למשתמש משויך יותר מתפקיד אחד בו-זמנית");
  }
  if (!isRepresentative && link) {
    issues.push('קיים קישור לפרופיל נציג עבור משתמש שאינו בתפקיד "נציג"');
  }
  if (isRepresentative && link && input.team_id && link.team_id && input.team_id !== link.team_id) {
    issues.push("צוות המשתמש אינו תואם את צוות הנציג המקושר");
  }
  // Manager ownership (the חן עטר case): a manager-role user whose profile
  // says "team X" while no teams.manager_id row names them LOOKS like the
  // manager of X but manages nothing — every manager scope in the app keys on
  // teams.manager_id, so this account silently has no managerial reach. That
  // is a configuration issue, not a cosmetic gap. A manager with no team at
  // all is merely incomplete setup (attention, added below).
  const isManagerOnly = input.roles.includes("manager") && !input.roles.includes("admin");
  const managedKnown = input.managed_team_ids !== undefined;
  const managesNothing = managedKnown && (input.managed_team_ids as string[]).length === 0;
  // A business-scope grant (מוקד/פעילות/סמנכ"ל) is real managerial reach —
  // it counts ONLY for the manager role, exactly like the SQL funnel's
  // is_manager guard, so a stray grant never launders another role's gaps.
  const scopedManager = isManagerOnly && input.has_business_scope === true;
  if (isManagerOnly && managesNothing && input.team_id && !scopedManager) {
    issues.push(
      "משויך לצוות בפרופיל אך אינו מוגדר כמנהל של אף צוות — יש להגדירו כמנהל הצוות בעמוד הצוותים",
    );
  }

  if (issues.length > 0) {
    return { status: "issue", ...STATUS_META.issue, reasons: issues };
  }

  const attention: string[] = [];
  if (input.roles.length === 0) {
    attention.push("לא הוגדר תפקיד למשתמש");
  }
  // A scoped manager (מנהל מוקד/פעילות/סמנכ"ל) legitimately has no profile
  // team and no direct teams.manager_id rows — their reach comes from the
  // business scope, so neither "no team" nor "manages nothing" is a gap.
  if (!input.team_id && !scopedManager) {
    attention.push("המשתמש אינו משויך לצוות");
  }
  if (isRepresentative && !link) {
    attention.push("לא קיים נציג מקושר לחשבון המשתמש");
  }
  if (isManagerOnly && managesNothing && !input.team_id && !scopedManager) {
    attention.push("מנהל צוות שאינו מנהל אף צוות — יש להגדירו כמנהל הצוות בעמוד הצוותים");
  }
  if (attention.length > 0) {
    return { status: "attention", ...STATUS_META.attention, reasons: attention };
  }

  return { status: "healthy", ...STATUS_META.healthy, reasons: [] };
}
