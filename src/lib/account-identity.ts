// The signed-in account's identity as the app should SAY it — pure, tested.
//
// The bug this exists to prevent: the header rendered the TECHNICAL role
// directly, so every `manager` — center manager, activity manager, executive —
// was announced as "מנהל צוות". The technical role is a permission level; the
// business title is a separate, DERIVED fact that lives in the resolved
// business scope (see resolveBusinessScope in business-scope.ts).
//
// Rules encoded here:
//   * admin and representative can always be stated truthfully from the
//     technical role alone — their business identity adds nothing;
//   * a technical manager's business level comes ONLY from the resolved scope;
//   * while that scope is unresolved (loading, errored, demo, absent) the
//     manager is shown as the neutral "מנהל" — never guessed down to
//     "מנהל צוות", and never guessed up to a scope they may not hold;
//   * a scope ERROR never fabricates a level: it degrades to the same neutral
//     label as loading.
// Nothing here is persisted, and no technical role is derived from a title.

import { BUSINESS_ROLE_LABEL, type BusinessScopeKind } from "@/lib/business-scope";

export const TECHNICAL_ROLE_LABEL = {
  admin: "מנהל מערכת",
  manager: "מנהל",
  representative: "נציג",
} as const;

/** A technical manager whose business level is not (yet) known. */
export const UNRESOLVED_MANAGER_LABEL = TECHNICAL_ROLE_LABEL.manager;
export const NO_ROLE_LABEL = "ללא תפקיד";

export type AccountIdentityInput = {
  /** Technical roles from auth — the permission level, nothing else. */
  roles: string[];
  /**
   * The resolved business scope, or null when it is loading, errored, disabled
   * (demo) or simply absent. Only `kind` and `title` are read.
   */
  scope: { kind: BusinessScopeKind; title: string } | null;
};

export type AccountIdentity = {
  /** The compact top-right label: business level, never a technical role. */
  compact: string;
  /**
   * The expanded label for account surfaces — the full resolved title
   * ("מנהל מוקד · דירות וחידושים") when one is truthfully available,
   * otherwise the same value as `compact`.
   */
  full: string;
  /** "הרשאת מערכת" — the technical permission, stated as such. */
  technicalLabel: string;
  /**
   * "תפקיד עסקי" — null whenever there is no business identity to show:
   * an admin (a system administrator is not a business executive), a
   * representative, or a manager whose scope has not resolved.
   */
  businessLabel: string | null;
  /** True while a technical manager is shown the neutral fallback. */
  isPendingBusinessTitle: boolean;
};

export function accountIdentity({ roles, scope }: AccountIdentityInput): AccountIdentity {
  // Admin first: the highest technical permission, and always truthful on its
  // own. An admin's scope kind is "admin" too, so this never contradicts it.
  if (roles.includes("admin")) {
    const label = TECHNICAL_ROLE_LABEL.admin;
    return {
      compact: label,
      full: label,
      technicalLabel: label,
      businessLabel: null,
      isPendingBusinessTitle: false,
    };
  }

  if (roles.includes("manager")) {
    // Only a resolved MANAGERIAL scope may name the business level. A scope
    // that resolved to representative/admin for a technical manager is not a
    // business level and is ignored rather than displayed.
    const kind = scope?.kind;
    const managerial =
      kind === "team_manager" || kind === "center" || kind === "activity" || kind === "executive";
    if (!managerial) {
      return {
        compact: UNRESOLVED_MANAGER_LABEL,
        full: UNRESOLVED_MANAGER_LABEL,
        technicalLabel: TECHNICAL_ROLE_LABEL.manager,
        businessLabel: null,
        isPendingBusinessTitle: true,
      };
    }
    const compact = BUSINESS_ROLE_LABEL[kind];
    // `title` already carries the unit ("מנהל מוקד · דירות וחידושים") and is
    // just the role label for a team manager and for an executive — no unit is
    // appended to an executive, because they hold none.
    const full = scope?.title?.trim() ? scope.title : compact;
    return {
      compact,
      full,
      technicalLabel: TECHNICAL_ROLE_LABEL.manager,
      businessLabel: full,
      isPendingBusinessTitle: false,
    };
  }

  if (roles.includes("representative")) {
    const label = TECHNICAL_ROLE_LABEL.representative;
    return {
      compact: label,
      full: label,
      technicalLabel: label,
      businessLabel: null,
      isPendingBusinessTitle: false,
    };
  }

  return {
    compact: NO_ROLE_LABEL,
    full: NO_ROLE_LABEL,
    technicalLabel: NO_ROLE_LABEL,
    businessLabel: null,
    isPendingBusinessTitle: false,
  };
}
