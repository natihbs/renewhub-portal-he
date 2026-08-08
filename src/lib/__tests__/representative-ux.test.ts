import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Representative UX hardening: the representative UI must not carry manager/
// admin concepts, and the representative's own details must be clearly
// openable. Source-pinned against the real screens; role hierarchy, RLS and
// server behavior are deliberately untouched by this PR.
// ---------------------------------------------------------------------------

const read = (rel: string) => readFileSync(resolve(__dirname, rel), "utf8");
const homeSrc = read("../../routes/_authenticated/index.tsx");
const homeCardsSrc = read("../../components/HomeCards.tsx");
const feedbackSrc = read("../../routes/_authenticated/feedback.tsx");
const perfSrc = read("../../routes/_authenticated/performance.tsx");
const repWorkspaceSrc = read("../../components/RepWorkspace.tsx");
const aiSrc = read("../../routes/_authenticated/ai-insights.tsx");
const aiFnsSrc = read("../ai-insights.functions.ts");

const repHome = homeSrc.slice(
  homeSrc.indexOf("function RepresentativeHome"),
  homeSrc.indexOf("function TopPerformersCard"),
);
const managerHome = homeSrc.slice(
  homeSrc.indexOf("function ManagerHome"),
  homeSrc.indexOf("function RepresentativeHome"),
);
const adminHome = homeSrc.slice(
  homeSrc.indexOf("function AdminHome"),
  homeSrc.indexOf("function SystemGapsCard"),
);

// ------------------------------------------------------------------ Issue A
describe("Issue A — data freshness bar is an operator concern", () => {
  it("representative home renders no DataFreshnessBar (no מצב הנתונים)", () => {
    expect(repHome).not.toContain("DataFreshnessBar");
    expect(repHome).not.toContain("מצב הנתונים");
  });

  it("manager home and admin home keep the freshness bar", () => {
    expect(managerHome).toContain("<DataFreshnessBar");
    expect(adminHome).toContain("<DataFreshnessBar");
  });

  it("the bar still says מצב הנתונים and computes freshness from a domain summary", () => {
    expect(homeCardsSrc).toContain("מצב הנתונים");
    expect(homeCardsSrc).toContain("summariseMonthlyFreshness");
  });

  it("real loading/error states on the representative's personal cards survive", () => {
    expect(repHome).toContain("state.repsLoading");
    expect(repHome).toContain("myGoal.isError");
    expect(repHome).toContain("לא ניתן לטעון את היעד האישי שלך כרגע.");
  });
});

// ------------------------------------------------------------------ Issue B
describe("Issue B — feedback is clearly openable", () => {
  const myFeedbackCard = homeCardsSrc.slice(
    homeCardsSrc.indexOf("export function MyFeedbackCard"),
    homeCardsSrc.indexOf("export function MyTasksCard"),
  );

  it("MyFeedbackCard keeps its product copy and gains a visible per-item action", () => {
    expect(homeCardsSrc).toContain("משובים שקיבלתי");
    expect(homeCardsSrc).toContain("טרם פורסם עבורך משוב");
    expect(myFeedbackCard).toContain("צפייה במשוב");
    expect(myFeedbackCard).toContain("search={{ feedbackId: f.id }}");
  });

  it("the card lists only the representative's own PUBLISHED feedback — drafts can never surface", () => {
    expect(myFeedbackCard).toContain("visibleFeedback(state.feedback, false, repId)");
  });

  it("/feedback accepts a feedbackId deep link and resolves it only against the viewer's visible list", () => {
    expect(feedbackSrc).toContain('feedbackId: typeof search.feedbackId === "string"');
    expect(feedbackSrc).toContain("feedbackListAll.some((f) => f.id === search.feedbackId)");
    // The dialog's record is also resolved from the visible list, never raw state.
    expect(feedbackSrc).toContain("view ? feedbackListAll.find((f) => f.id === view)");
    expect(feedbackSrc).not.toContain("view ? state.feedback.find");
  });

  it("an unknown or unauthorized feedbackId shows a calm not-found line, not a crash", () => {
    expect(feedbackSrc).toContain("המשוב המבוקש לא נמצא או שאינו זמין עבורך.");
    expect(feedbackSrc).toContain("setDeepLinkMiss(true)");
  });

  it("the detail dialog is the full existing FeedbackView, titled פירוט משוב, with manager actions gated on isManager", () => {
    expect(feedbackSrc).toContain("פירוט משוב");
    expect(feedbackSrc).toContain("<FeedbackView");
    // Read-only for a representative: every action block sits inside isManager.
    const view = feedbackSrc.slice(
      feedbackSrc.indexOf("function FeedbackView"),
      feedbackSrc.indexOf("function RevisionHistory"),
    );
    expect(view).toContain("{isManager && (");
    // Full details, revision history included (RLS-scoped for reps).
    for (const field of [
      "תאריך",
      "מזהה שיחה",
      "סוג שיחה",
      "מאזין",
      "ציון כללי",
      "ציון לפי סעיף",
      "נקודות לשימור",
      "נקודות לשיפור",
      "סיכום מנהל",
      "משימה להמשך",
      "RevisionHistory",
    ]) {
      expect(view).toContain(field);
    }
  });
});

// ------------------------------------------------------------------ Issue E
describe("Issue E — representative /feedback is feedback-first", () => {
  const repRegion = feedbackSrc.slice(
    feedbackSrc.indexOf("{isManager ? ("),
    feedbackSrc.indexOf("{isManager && ("),
  );

  it("the history table leads; tasks/notes fold into a collapsed secondary section below", () => {
    const historyAt = repRegion.lastIndexOf("<HistoryTable");
    const tasksAt = repRegion.indexOf('<CollapsibleSection title="המשימות וההערות שלי">');
    expect(historyAt).toBeGreaterThan(-1);
    expect(tasksAt).toBeGreaterThan(historyAt);
    expect(repRegion).toContain("<MyTasksAndNotes />");
  });

  it("the representative call site shows the visible צפייה במשוב action and the rep empty state — and never the publish wiring", () => {
    const calls = repRegion.split("<HistoryTable").slice(1);
    expect(calls.length).toBe(2);
    const repCall = calls[1];
    expect(repCall).toContain("showViewLabel");
    expect(repCall).toContain('emptyTitle="טרם פורסם עבורך משוב"');
    expect(repCall).not.toContain("onPublish");
  });

  it("HistoryTable renders a text 'צפייה במשוב' button in rep mode and keeps the icon-only eye for managers", () => {
    const table = feedbackSrc.slice(
      feedbackSrc.indexOf("function HistoryTable"),
      feedbackSrc.indexOf("function FeedbackView"),
    );
    expect(table).toContain("{showViewLabel ? (");
    expect(table).toContain("צפייה במשוב");
    expect(table).toContain('aria-label="צפייה בהאזנה"');
  });

  it("the representative's task/note visibility itself is preserved (own tasks toggleable, only non-private notes)", () => {
    const tasksAndNotes = feedbackSrc.slice(
      feedbackSrc.indexOf("function MyTasksAndNotes"),
      feedbackSrc.indexOf("// -------------------- History table"),
    );
    expect(tasksAndNotes).toContain("toggleTask(repId, t.id)");
    expect(tasksAndNotes).toContain(".filter((n) => !n.isPrivate)");
  });

  it("the visible-feedback boundary is the shared rule: reps get own published only", () => {
    expect(feedbackSrc).toContain("visibleFeedback(state.feedback, isManager, state.currentRepId)");
  });
});

// ------------------------------------------------------------------ Issue C
describe("Issue C — representative /performance is personal, not a narrowed manager table", () => {
  const repPerf = perfSrc.slice(
    perfSrc.indexOf("function RepresentativePerformancePage"),
    perfSrc.indexOf("function ManagerPerformancePage"),
  );
  const managerPerf = perfSrc.slice(
    perfSrc.indexOf("function ManagerPerformancePage"),
    perfSrc.indexOf("// -------- small pieces"),
  );

  it("the page splits by role at the component level", () => {
    expect(perfSrc).toContain(
      "return isManager ? <ManagerPerformancePage /> : <RepresentativePerformancePage />;",
    );
  });

  it("the personal view carries every required personal figure", () => {
    for (const label of [
      "יעד אישי",
      "ביצוע נוכחי",
      "אחוז עמידה",
      "נותר ליעד",
      "קצב יומי מומלץ",
      "תחזית סוף חודש",
      "REP_STATUS_LABEL",
    ]) {
      expect(repPerf).toContain(label);
    }
  });

  it("personal pace-status labels are personal — never the manager's 'דורש טיפול'", () => {
    expect(perfSrc).toContain('above: "מעל הקצב"');
    expect(perfSrc).toContain('onpace: "בקצב"');
    expect(perfSrc).toContain('attention: "מתחת לקצב"');
    expect(repPerf).not.toContain("דורש טיפול");
  });

  it("no manager controls in the personal view: no export/print, no manual update, no add-rep, no filters, no workspace", () => {
    for (const forbidden of [
      "exportCsv",
      "downloadCsv",
      "window.print",
      "ייצוא ל-Excel",
      "הדפסה",
      "ManualPerformanceDialog",
      "RepFormDialog",
      "statusFilter",
      "openWorkspace",
      "useRepWorkspace",
    ]) {
      expect(repPerf).not.toContain(forbidden);
    }
  });

  it("the manager page is unchanged: table, filters, export, print, manual update, add-rep, workspace opening", () => {
    for (const kept of [
      "ייצוא ל-Excel",
      "הדפסה / שמירה כ-PDF",
      "ManualPerformanceDialog",
      "הוספת נציג",
      "statusFilter",
      "openWorkspace(e.rep.id)",
      "טבלת ביצועים",
    ]) {
      expect(managerPerf).toContain(kept);
    }
  });
});

// ------------------------------------------------------------------ Issue D
describe("Issue D — the manager RepWorkspace never renders for a representative", () => {
  it("the sheet component itself is role-gated before anything renders", () => {
    const component = repWorkspaceSrc.slice(
      repWorkspaceSrc.indexOf("export function RepWorkspace()"),
      repWorkspaceSrc.indexOf("function onCloseSafe"),
    );
    expect(component).toContain("if (!isManager) return null;");
    // The gate sits before the Sheet markup, so no residual open() path can
    // present manager notes/tasks UI to a representative.
    expect(component.indexOf("if (!isManager) return null;")).toBeLessThan(
      component.indexOf("<Sheet"),
    );
  });

  it("manager write actions still exist behind the gate — הוסף הערה and הוסף משימה, note/task delete", () => {
    expect(repWorkspaceSrc).toContain("הוסף הערה");
    expect(repWorkspaceSrc).toContain("הוסף משימה");
    expect(repWorkspaceSrc).toContain("deleteNote(rep.id, n.id)");
    expect(repWorkspaceSrc).toContain("deleteTask(rep.id, t.id)");
  });

  it("the representative keeps their own read surface: tasks toggle and visible notes on /feedback", () => {
    expect(feedbackSrc).toContain("<MyTasksAndNotes />");
    expect(feedbackSrc).toContain("toggleTask(repId, t.id)");
  });
});

// ------------------------------------------------------------------ Issue F
describe("Issue F — representative AI insights are personal (Option 1)", () => {
  it("representative copy: personal title, personal card labels, personal-scope notice", () => {
    expect(aiSrc).toContain("התובנות שלי");
    expect(aiSrc).toContain("התקדמות מול היעד שלי");
    expect(aiSrc).toContain("מה חוזר במשובים שלי");
    expect(aiSrc).toContain("איך להשתפר לקראת החודש הבא");
    expect(aiSrc).toContain("התובנות מבוססות על הנתונים האישיים שלך בלבד.");
  });

  it("manager copy is unchanged", () => {
    expect(aiSrc).toContain("תובנות AI");
    expect(aiSrc).toContain("ניתוח מצב הצוותים והנציגים מול היעדים החודשיים");
    expect(aiSrc).toContain("סיכום משוב והאזנות");
    expect(aiSrc).toContain("המלצות ליעדים");
  });

  it("Option 1 is justified: the server functions already enforce representative scope", () => {
    // Fetches run through the CALLER's RLS-scoped client…
    expect(aiFnsSrc).toContain("ctx.supabase");
    // …the role comes from user_roles, server-side…
    expect(aiFnsSrc).toContain('from("user_roles")');
    // …and both prompt builders additionally filter to the rep's own rows.
    expect(aiFnsSrc).toContain('scope.role === "representative" && scope.repId');
    const filterCount = aiFnsSrc.split('scope.role === "representative"').length - 1;
    expect(filterCount).toBeGreaterThanOrEqual(2);
  });

  it("the route stays and the nav entry stays available to representatives", () => {
    expect(aiSrc).toContain('createFileRoute("/_authenticated/ai-insights")');
    const navSrc = read("../navigation-config.ts");
    expect(navSrc).toContain(
      'id: "ai-insights", to: "/ai-insights", icon: Sparkles, roles: ["manager", "representative"]',
    );
  });
});

// ------------------------------------------------- product/role boundaries
describe("boundaries — no role/hierarchy/worklist/CRM changes", () => {
  it("the changed files carry no worklist/queue/customer/call-outcome vocabulary", () => {
    for (const src of [homeCardsSrc, repWorkspaceSrc, aiSrc]) {
      for (const term of ["worklist", "call_outcome", "customer_id", "next customer"]) {
        expect(src.toLowerCase()).not.toContain(term);
      }
    }
  });

  it("no technical-role or hierarchy machinery was introduced in the touched UI files", () => {
    for (const src of [homeCardsSrc, repWorkspaceSrc, aiSrc, perfSrc]) {
      expect(src).not.toContain('from("user_roles")');
      expect(src).not.toContain("hierarchy");
    }
  });
});
