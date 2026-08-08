import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  managerScopeLabel,
  NO_MANAGED_TEAM_LABEL,
  TEAM_SCOPE_LOADING_LABEL,
  type Workspace,
} from "@/lib/workspace-context";
import {
  normalizeAnnouncementInput,
  ANNOUNCEMENT_AUDIENCE_ORG_LABEL,
  ANNOUNCEMENT_PUBLISH_FORBIDDEN_MESSAGE,
} from "@/lib/announcements.functions";

const read = (rel: string) => readFileSync(resolve(__dirname, rel), "utf8");
const homeSrc = read("../../routes/_authenticated/index.tsx");
const commsSrc = read("../../routes/_authenticated/communications.tsx");
const announceFns = read("../announcements.functions.ts");

// ---------------------------------------------------------------------------
// Issue A — ManagerHome header scope label. The חן עטר contradiction: the
// workspace selector showed the managed team while the header said
// "ללא צוות משויך". The label now resolves through managerScopeLabel, whose
// inputs are the workspace and the MANAGED teams (teams.manager_id) — never
// profiles.team_id.
// ---------------------------------------------------------------------------

const teamWorkspace: Workspace = { type: "team", teamId: "t-dira", teamName: "חידושי דירה" };
const orgWorkspace: Workspace = { type: "org" };

describe("managerScopeLabel — the header can no longer contradict the workspace selector", () => {
  it("a selected team workspace shows that team's name", () => {
    expect(managerScopeLabel({ workspace: teamWorkspace, managedTeams: [], ready: true })).toBe(
      "חידושי דירה",
    );
  });

  it("the reproduced bug: workspace not yet resolved to a team, one managed team — shows the managed team, never 'ללא צוות משויך'", () => {
    const label = managerScopeLabel({
      workspace: orgWorkspace,
      managedTeams: [{ name: "חידושי דירה" }],
      ready: true,
    });
    expect(label).toBe("חידושי דירה");
    expect(label).not.toBe("ללא צוות משויך");
  });

  it("the same holds before team data is ready — the known managed team wins over any placeholder", () => {
    expect(
      managerScopeLabel({
        workspace: orgWorkspace,
        managedTeams: [{ name: "חידושי דירה" }],
        ready: false,
      }),
    ).toBe("חידושי דירה");
  });

  it("a manager who truly manages zero teams gets the honest warning — once the data has loaded", () => {
    expect(managerScopeLabel({ workspace: orgWorkspace, managedTeams: [], ready: true })).toBe(
      NO_MANAGED_TEAM_LABEL,
    );
    expect(NO_MANAGED_TEAM_LABEL).toBe("לא הוגדר צוות לניהול");
  });

  it("while teams are still loading, no 'no team' claim of any kind is made", () => {
    const label = managerScopeLabel({ workspace: orgWorkspace, managedTeams: [], ready: false });
    expect(label).toBe(TEAM_SCOPE_LOADING_LABEL);
    expect(label).not.toBe(NO_MANAGED_TEAM_LABEL);
    expect(label).not.toBe("ללא צוות משויך");
  });
});

describe("HomeHeader wiring (source-pinned)", () => {
  it("the manager branch resolves through managerScopeLabel, not a raw workspace ternary", () => {
    expect(homeSrc).toContain("managerScopeLabel({ workspace, managedTeams, ready })");
    expect(homeSrc).not.toContain('workspace.type === "team" ? workspace.teamName : NO_TEAM_LABEL');
  });

  it("managed teams come from teams.manager_id (managerId === user.id) — profiles.team_id is not an input", () => {
    expect(homeSrc).toContain("visibleTeams.filter((t) => t.managerId === user?.id)");
    const header = homeSrc.slice(
      homeSrc.indexOf("function HomeHeader"),
      homeSrc.indexOf("function AdminHome"),
    );
    expect(header).not.toContain("profile?.team_id");
    expect(header).not.toContain("me?.teamId");
  });

  it("admin behavior is unchanged: system-console label, and admin-in-manager-view still requires a selected team", () => {
    expect(homeSrc).toContain('const ADMIN_SCOPE_LABEL = "ניהול מערכת"');
    expect(homeSrc).toContain("? ADMIN_SCOPE_LABEL");
    // The HomePage gate that keeps an admin's manager view honest: without a
    // team workspace, ManagerHome (and its header) never renders.
    expect(homeSrc).toContain('realRole === "admin" && workspace.type !== "team"');
    expect(homeSrc).toContain("בחרו צוות לתצוגה");
  });

  it("the representative branch keeps its own membership label untouched", () => {
    expect(homeSrc).toContain(": me?.teamName || NO_TEAM_LABEL;");
  });
});

// ---------------------------------------------------------------------------
// Issue B — publishing a generated communication as a real internal
// announcement, organization-wide and honestly labeled.
// ---------------------------------------------------------------------------

describe("publishAnnouncement input validation (pure)", () => {
  it("trims and accepts a valid communications-sourced input", () => {
    expect(
      normalizeAnnouncementInput({ title: " עדכון ", body: " תוכן ", source: "communications" }),
    ).toEqual({ title: "עדכון", body: "תוכן", source: "communications" });
  });

  it("rejects an empty title, an empty body and an unknown source", () => {
    expect(() =>
      normalizeAnnouncementInput({ title: "  ", body: "x", source: "communications" }),
    ).toThrow("נדרשת כותרת להודעה");
    expect(() =>
      normalizeAnnouncementInput({ title: "x", body: "  ", source: "communications" }),
    ).toThrow("נדרש תוכן להודעה");
    expect(() =>
      normalizeAnnouncementInput({ title: "x", body: "y", source: "elsewhere" as never }),
    ).toThrow("מקור פרסום לא מוכר");
  });
});

describe("publish authorization and audit (source-pinned against the server fn)", () => {
  it("only the real admin/manager role may publish — a representative is rejected server-side", () => {
    expect(announceFns).toContain('roles.includes("admin")');
    expect(announceFns).toContain('roles.includes("manager")');
    expect(announceFns).toContain("ANNOUNCEMENT_PUBLISH_FORBIDDEN_MESSAGE");
    expect(ANNOUNCEMENT_PUBLISH_FORBIDDEN_MESSAGE).toBe("אין הרשאה לפרסום הודעות פנימיות");
    // Roles come from user_roles for the authenticated user — the client's
    // presentation state never reaches this file.
    expect(announceFns).toContain('from("user_roles")');
    expect(announceFns).not.toContain("admin-view");
    expect(announceFns).not.toContain("AdminViewMode");
  });

  it("audience is explicitly organization-wide — no fake team scope over a schema that has none", () => {
    expect(ANNOUNCEMENT_AUDIENCE_ORG_LABEL).toBe("לכל הארגון");
    expect(announceFns).toContain('audience: "org"');
    expect(announceFns).toContain("audience_label: ANNOUNCEMENT_AUDIENCE_ORG_LABEL");
    // The insert writes no team column — the announcements table has none,
    // and pretending otherwise would misrepresent who can read the row.
    expect(announceFns).not.toContain("team_id");
  });

  it("the audit entry records action, title, audience, source and actor", () => {
    expect(announceFns).toContain('"announcement.published"');
    expect(announceFns).toContain("announcement_id: row.id");
    expect(announceFns).toContain("title: data.title");
    expect(announceFns).toContain("source: data.source");
    expect(announceFns).toContain("actor_id: ctx.userId");
    expect(announceFns).toContain("created_by: ctx.userId");
  });
});

describe("communications publish UX (source-pinned)", () => {
  it("the internal-message preview carries the publish action", () => {
    const internalTab = commsSrc.slice(
      commsSrc.indexOf('<TabsContent value="internal"'),
      commsSrc.indexOf("</Tabs>", commsSrc.indexOf('<TabsContent value="internal"')),
    );
    expect(internalTab).toContain("<PublishInternalAnnouncement");
    expect(commsSrc).toContain("פרסום כהודעה פנימית");
  });

  it("publishing asks for confirmation showing title, audience and a body preview", () => {
    const publisher = commsSrc.slice(
      commsSrc.indexOf("function PublishInternalAnnouncement"),
      commsSrc.indexOf("// ---------- Templates panel"),
    );
    expect(publisher).toContain("אישור פרסום הודעה פנימית");
    expect(publisher).toContain("כותרת");
    expect(publisher).toContain("קהל יעד");
    expect(publisher).toContain("ANNOUNCEMENT_AUDIENCE_ORG_LABEL");
    expect(publisher).toContain("תוכן ההודעה");
  });

  it("publish creates a real announcement (server fn in live mode, addAnnouncement in demo) — not a history row", () => {
    const publisher = commsSrc.slice(
      commsSrc.indexOf("function PublishInternalAnnouncement"),
      commsSrc.indexOf("// ---------- Templates panel"),
    );
    expect(publisher).toContain("publishFn({");
    expect(publisher).toContain("addAnnouncement({ title: title.trim(), body: body.trim() })");
    expect(publisher).toContain('qc.invalidateQueries({ queryKey: ["cloud", "announcements"] })');
    expect(publisher).not.toContain("saveMessage");
  });

  it("שמירה בהיסטוריה and העתק remain their own, unchanged actions", () => {
    expect(commsSrc).toContain("saveMessage({ kind, title, body });");
    expect(commsSrc).toContain('toast.success("נשמר בהיסטוריה")');
    expect(commsSrc).toContain("await navigator.clipboard.writeText(body);");
  });

  it("published announcements surface on both homes through the existing announcements card", () => {
    // ManagerHome (isStaff) and RepresentativeHome both render the same
    // AnnouncementsCard over state.announcements — org-wide visibility, which
    // is exactly what the publish flow labels.
    expect(homeSrc).toContain("<AnnouncementsCard announcements={announcements} isStaff />");
    expect(homeSrc).toContain(
      "<AnnouncementsCard announcements={announcements} isStaff={false} />",
    );
  });
});

describe("product boundary — no CRM/queue/call-outcome surface in the changed files", () => {
  it("the new and touched files carry no worklist/queue/customer-workflow vocabulary", () => {
    for (const src of [announceFns, read("../workspace-context.tsx")]) {
      for (const term of ["worklist", "queue", "call_outcome", "customer_id", "next customer"]) {
        expect(src.toLowerCase()).not.toContain(term);
      }
    }
  });
});
