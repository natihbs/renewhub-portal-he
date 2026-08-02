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
  if (issues.length > 0) {
    return { status: "issue", ...STATUS_META.issue, reasons: issues };
  }

  const attention: string[] = [];
  if (input.roles.length === 0) {
    attention.push("לא הוגדר תפקיד למשתמש");
  }
  if (!input.team_id) {
    attention.push("המשתמש אינו משויך לצוות");
  }
  if (isRepresentative && !link) {
    attention.push("לא קיים נציג מקושר לחשבון המשתמש");
  }
  if (attention.length > 0) {
    return { status: "attention", ...STATUS_META.attention, reasons: attention };
  }

  return { status: "healthy", ...STATUS_META.healthy, reasons: [] };
}
