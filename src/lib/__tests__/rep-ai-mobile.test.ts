import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { AI_INSIGHT_FRIENDLY_ERROR, friendlyAiInsightError } from "@/lib/ai-insights-domain";

// ---------------------------------------------------------------------------
// Live-QA fixes after PR #35:
//  A. /ai-insights failed for a representative with the gateway error
//     "Invalid prompt: System messages are not allowed in the prompt or
//     messages fields. Use the instructions option instead." — the request
//     carried a system-role message inside `messages`.
//  B. /ai-insights top area clipped/overlapped long Hebrew labels on mobile.
//  C. the representative feedback history hid "צפייה במשוב" behind horizontal
//     scroll on mobile.
// ---------------------------------------------------------------------------

const read = (rel: string) => readFileSync(resolve(__dirname, rel), "utf8");
const aiFnsSrc = read("../ai-insights.functions.ts");
const aiPageSrc = read("../../routes/_authenticated/ai-insights.tsx");
const feedbackSrc = read("../../routes/_authenticated/feedback.tsx");

// ------------------------------------------------------------------ Issue A
describe("Issue A — the AI request carries no system message", () => {
  const generateInsightSrc = aiFnsSrc.slice(
    aiFnsSrc.indexOf("async function generateInsight"),
    aiFnsSrc.indexOf("function formatPerformancePrompt"),
  );

  it("no system role appears anywhere in the functions module", () => {
    expect(aiFnsSrc).not.toContain('role: "system"');
    expect(aiFnsSrc).not.toContain("role: 'system'");
  });

  it("generateText gets user content via `prompt` only — no messages array at all", () => {
    expect(generateInsightSrc).toContain("prompt,");
    expect(generateInsightSrc).not.toContain("messages:");
  });

  it("system guidance travels through the provider's `instructions` option", () => {
    expect(generateInsightSrc).toContain("providerOptions: { lovable: { instructions } }");
    // The three insight kinds still supply their guidance — now as instructions.
    expect(aiFnsSrc).toContain("generateInsight(prompt, SYSTEM_PERFORMANCE, hasData)");
    expect(aiFnsSrc).toContain("generateInsight(prompt, SYSTEM_FEEDBACK, hasData)");
    expect(aiFnsSrc).toContain("generateInsight(prompt, SYSTEM_GOALS, hasData)");
  });

  it("role scoping is untouched: representative rows are still filtered to self, server-side", () => {
    expect(aiFnsSrc).toContain('scope.role === "representative" && scope.repId');
    const filterCount = aiFnsSrc.split('scope.role === "representative"').length - 1;
    expect(filterCount).toBeGreaterThanOrEqual(2);
    expect(aiFnsSrc).toContain('from("user_roles")');
  });
});

describe("Issue A — friendly Hebrew error, technical detail in logs only", () => {
  it("raw English provider text is replaced by the calm Hebrew line", () => {
    expect(
      friendlyAiInsightError(
        new Error(
          "Invalid prompt: System messages are not allowed in the prompt or messages fields. Use the instructions option instead.",
        ),
      ),
    ).toBe(AI_INSIGHT_FRIENDLY_ERROR);
    expect(AI_INSIGHT_FRIENDLY_ERROR).toBe("לא הצלחנו ליצור תובנה כרגע. נסו שוב בעוד רגע.");
  });

  it("a Hebrew message written for the user passes through unchanged", () => {
    expect(friendlyAiInsightError(new Error("לא הצלחנו ליצור תובנה כרגע. נסו שוב בעוד רגע."))).toBe(
      AI_INSIGHT_FRIENDLY_ERROR,
    );
    expect(friendlyAiInsightError(new Error("אין לך הרשאה לפעולה זו"))).toBe(
      "אין לך הרשאה לפעולה זו",
    );
  });

  it("non-Error and empty inputs fall back to the friendly line", () => {
    expect(friendlyAiInsightError(undefined)).toBe(AI_INSIGHT_FRIENDLY_ERROR);
    expect(friendlyAiInsightError("TypeError: fetch failed")).toBe(AI_INSIGHT_FRIENDLY_ERROR);
    expect(friendlyAiInsightError(new Error(""))).toBe(AI_INSIGHT_FRIENDLY_ERROR);
  });

  it("the server catch throws the friendly line and logs the original; the page does the same", () => {
    expect(aiFnsSrc).toContain('console.error("[ai-insights] generation failed", error)');
    expect(aiFnsSrc).toContain("throw new Error(AI_INSIGHT_FRIENDLY_ERROR)");
    expect(aiPageSrc).toContain("friendlyAiInsightError(e)");
    expect(aiPageSrc).toContain('console.error("[ai-insights] generation failed", e)');
    // The old raw pass-through is gone.
    expect(aiPageSrc).not.toContain("e instanceof Error ? e.message");
  });

  it("the representative personalization from PR #35 is intact", () => {
    for (const copy of [
      "התובנות שלי",
      "התקדמות מול היעד שלי",
      "מה חוזר במשובים שלי",
      "איך להשתפר לקראת החודש הבא",
      "התובנות מבוססות על הנתונים האישיים שלך בלבד.",
    ]) {
      expect(aiPageSrc).toContain(copy);
    }
  });
});

// ------------------------------------------------------------------ Issue B
describe("Issue B — /ai-insights top area is mobile/RTL safe", () => {
  it("the tab bar wraps instead of clipping — no fixed 3-column grid", () => {
    expect(aiPageSrc).not.toContain("grid w-full grid-cols-3");
    expect(aiPageSrc).toContain('className="flex h-auto w-full flex-wrap justify-start md:w-auto"');
    expect(aiPageSrc).toContain('className="whitespace-normal"');
  });

  it("insight card headers let long Hebrew labels shrink and wrap, badge never shrinks", () => {
    expect(aiPageSrc).toContain('className="flex flex-wrap items-start justify-between gap-2"');
    expect(aiPageSrc).toContain('className="flex min-w-0 items-center gap-2"');
    expect(aiPageSrc).toContain('className="min-w-0 break-words text-base"');
    expect(aiPageSrc).toContain('Badge variant="outline" className="shrink-0"');
    expect(aiPageSrc).toContain("break-words");
  });

  it("the insight cards grid stays single-column on mobile — no forced horizontal overflow", () => {
    expect(aiPageSrc).toContain("grid grid-cols-1 md:grid-cols-3 gap-4");
  });
});

// ------------------------------------------------------------------ Issue C
describe("Issue C — representative feedback history is reachable on mobile", () => {
  const table = feedbackSrc.slice(
    feedbackSrc.indexOf("function HistoryTable"),
    feedbackSrc.indexOf("function FeedbackView"),
  );

  it("rep mode renders mobile cards below the desktop breakpoint, with the visible action", () => {
    const mobileList = table.slice(
      table.indexOf('<div className="space-y-3 lg:hidden">'),
      table.indexOf('<div className={cn("overflow-x-auto"'),
    );
    expect(mobileList.length).toBeGreaterThan(0);
    // date, call type, listener, score, short summary, visible action
    expect(mobileList).toContain("formatDateIL(f.date)");
    expect(mobileList).toContain("f.callType");
    expect(mobileList).toContain("מאזין/ה");
    expect(mobileList).toContain("ציון {f.score}");
    expect(mobileList).toContain("f.keep || f.improve");
    expect(mobileList).toContain("צפייה במשוב");
    // Full-width button — no horizontal scrolling needed to find it.
    expect(mobileList).toContain('className="mt-3 w-full"');
  });

  it("in rep mode the wide table only renders from the desktop breakpoint; manager markup is unchanged", () => {
    expect(table).toContain('cn("overflow-x-auto", showViewLabel && "hidden lg:block")');
    // The mobile card list exists only behind showViewLabel — a manager keeps
    // the always-visible table with untouched actions.
    const mobileAt = table.indexOf('<div className="space-y-3 lg:hidden">');
    const gateAt = table.lastIndexOf("{showViewLabel && (", mobileAt);
    expect(gateAt).toBeGreaterThan(-1);
    expect(table).toContain('aria-label="צפייה בהאזנה"');
    expect(table).toContain("פרסום לנציג");
  });

  it("visibility rules are untouched: reps see own published only, and the deep link resolves against the visible list", () => {
    expect(feedbackSrc).toContain("visibleFeedback(state.feedback, isManager, state.currentRepId)");
    expect(feedbackSrc).toContain("feedbackListAll.some((f) => f.id === search.feedbackId)");
    expect(feedbackSrc).toContain("view ? feedbackListAll.find((f) => f.id === view)");
    expect(feedbackSrc).toContain("המשוב המבוקש לא נמצא או שאינו זמין עבורך.");
  });
});

// ------------------------------------------------------- product boundaries
describe("boundaries — no role/hierarchy/worklist/CRM changes", () => {
  it("the changed files carry no worklist/queue/customer/call-outcome vocabulary", () => {
    for (const src of [aiPageSrc, read("../ai-insights-domain.ts")]) {
      for (const term of ["worklist", "call_outcome", "customer_id", "next customer"]) {
        expect(src.toLowerCase()).not.toContain(term);
      }
    }
  });
});
