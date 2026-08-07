import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  OUTCOME_CHOICES,
  contextLines,
  remainingSentence,
  scoreboardStats,
  scoreboardSummary,
  outcomeErrorMessage,
  containsForbiddenTerm,
  NO_CONTEXT_MESSAGE,
  FORBIDDEN_UI_TERMS,
  type ItemContext,
  type ScoreboardInput,
} from "@/lib/worklist-view";
import { RECORDABLE_OUTCOME_STATES } from "@/lib/queue-domain";

const ctx = (over: Partial<ItemContext> = {}): ItemContext => ({
  subjectLabel: "משה כהן",
  subjectRef: "CUST-4812",
  dueAt: "2026-08-20T00:00:00.000Z",
  businessValue: 4200,
  touchCount: 0,
  ...over,
});

// ---------------------------------------------------------------------------
// The outcome bar
// ---------------------------------------------------------------------------

describe("outcome choices", () => {
  it("offers exactly the five states the write path accepts", () => {
    expect(OUTCOME_CHOICES.map((c) => c.state).sort()).toEqual(
      [...RECORDABLE_OUTCOME_STATES].sort(),
    );
  });

  it("uses the agreed Hebrew labels, in order", () => {
    expect(OUTCOME_CHOICES.map((c) => c.label)).toEqual([
      "טופל בהצלחה",
      "לא נסגר",
      "ממתין לגורם פנימי",
      "ממתין ללקוח",
      "לא ניתן להשגה",
    ]);
  });

  it("marks only the two concluding states as concluding", () => {
    const concluding = OUTCOME_CHOICES.filter((c) => c.concludes).map((c) => c.state);
    expect(concluding).toEqual(["resolved_positive", "resolved_negative"]);
  });
});

// ---------------------------------------------------------------------------
// Context panel
// ---------------------------------------------------------------------------

describe("context panel", () => {
  it("shows every field the API returned", () => {
    const lines = contextLines(ctx({ touchCount: 2 }));
    expect(lines.map((l) => l.label)).toEqual([
      "לקוח",
      "מספר לקוח",
      "תאריך חידוש",
      "פרמיה שנתית",
      "פניות קודמות",
    ]);
  });

  it("OMITS a missing field rather than inventing a placeholder", () => {
    // A dash where a customer name belongs reads as a system fault, and after
    // the third one nobody trusts the panel.
    const lines = contextLines(ctx({ subjectLabel: null, subjectRef: "  ", dueAt: null }));
    expect(lines.map((l) => l.label)).toEqual(["פרמיה שנתית"]);
  });

  it("returns nothing at all when the API returned nothing, so the caller can say so", () => {
    const lines = contextLines({
      subjectLabel: null,
      subjectRef: null,
      dueAt: null,
      businessValue: 0,
      touchCount: 0,
    });
    expect(lines).toEqual([]);
    expect(NO_CONTEXT_MESSAGE).toBe("אין מידע נוסף להצגה");
  });

  it("formats money and dates for Israel", () => {
    const lines = contextLines(ctx({ businessValue: 12345 }));
    const money = lines.find((l) => l.label === "פרמיה שנתית")!.value;
    const date = lines.find((l) => l.label === "תאריך חידוש")!.value;
    expect(money).toContain("₪");
    expect(money).toContain("12,345");
    expect(date).toBe("20.08.2026");
  });

  it("counts one prior contact differently from several", () => {
    expect(
      contextLines(ctx({ touchCount: 1 })).find((l) => l.label === "פניות קודמות")!.value,
    ).toBe("פנייה אחת");
    expect(
      contextLines(ctx({ touchCount: 4 })).find((l) => l.label === "פניות קודמות")!.value,
    ).toBe("4 פניות");
  });
});

describe("remaining count", () => {
  it("reads as a sentence, with Hebrew singular and plural", () => {
    expect(remainingSentence(0)).toBe("אין לקוחות ממתינים");
    expect(remainingSentence(1)).toBe("נותר לקוח אחד");
    expect(remainingSentence(1234)).toBe("נותרו 1,234 לקוחות");
  });
});

// ---------------------------------------------------------------------------
// Scoreboard
// ---------------------------------------------------------------------------

const score = (
  over: Partial<Extract<ScoreboardInput, { available: true }>> = {},
): ScoreboardInput => ({
  available: true,
  engagedCount: 42,
  eligibleCount: 60,
  expiredUnworkedCount: 8,
  pendingCount: 10,
  expiredUnworkedValue: 61_000,
  pendingValue: 40_000,
  ...over,
});

describe("scoreboard", () => {
  it("shows counts and money only — no percentage anywhere", () => {
    const stats = scoreboardStats(score());
    for (const s of stats) expect(s.value).not.toContain("%");
    const summary = scoreboardSummary(score()) ?? "";
    expect(summary).not.toContain("%");
  });

  it("shows nothing at all when coverage is unavailable, rather than zeros", () => {
    // Rendering zeros would tell a representative they have done nothing, on
    // the morning the feed failed.
    const stats = scoreboardStats({ available: false, detail: "המלאי אינו עדכני" });
    expect(stats).toEqual([]);
    expect(scoreboardSummary({ available: false, detail: "x" })).toBeNull();
  });

  it("flags overdue work for attention and leaves the rest neutral", () => {
    const stats = scoreboardStats(score());
    expect(stats.find((s) => s.label === "חלף מועד החידוש")!.tone).toBe("attention");
    expect(stats.find((s) => s.label === "טופלו החודש")!.tone).toBe("neutral");
  });

  it("does not flag attention when nothing has slipped", () => {
    const stats = scoreboardStats(score({ expiredUnworkedCount: 0, expiredUnworkedValue: 0 }));
    expect(stats.every((s) => s.tone === "neutral")).toBe(true);
  });

  it("says the money at stake when work has slipped", () => {
    expect(scoreboardSummary(score())).toContain("₪");
    expect(scoreboardSummary(score())).toContain("8");
  });

  it("says so plainly when nothing has slipped", () => {
    expect(
      scoreboardSummary(
        score({ expiredUnworkedCount: 0, expiredUnworkedValue: 0, pendingCount: 0 }),
      ),
    ).toContain("טופלו");
  });

  it("carries no rank, trend or comparison to anyone else", () => {
    const text = [
      scoreboardStats(score())
        .map((s) => s.label)
        .join(" "),
      scoreboardSummary(score()) ?? "",
    ].join(" ");
    for (const banned of ["מקום", "דירוג", "לעומת", "ממוצע הצוות", "מגמה"]) {
      expect(text).not.toContain(banned);
    }
  });
});

// ---------------------------------------------------------------------------
// Failure messaging
// ---------------------------------------------------------------------------

describe("outcome failure text", () => {
  it("passes the server's specific Hebrew message through", () => {
    const text = outcomeErrorMessage(new Error("הפריט אינו משויך לנציג הרושם"));
    expect(text).toContain("הפריט אינו משויך לנציג הרושם");
  });

  it("always states that the customer stayed on the list", () => {
    // The operator must know the work was NOT lost, or they will re-dial.
    expect(outcomeErrorMessage(new Error("שגיאה כלשהי בעברית"))).toContain("נשאר ברשימה");
    expect(outcomeErrorMessage(new Error(""))).toContain("נשאר ברשימה");
  });

  it("never shows an English framework error to a representative mid-call", () => {
    const text = outcomeErrorMessage(new Error("TypeError: Cannot read properties of undefined"));
    expect(text).not.toContain("TypeError");
    expect(text).toContain("נכשל");
  });

  it("never reads as success", () => {
    for (const input of [new Error("x"), new Error("שגיאה"), "", null]) {
      const text = outcomeErrorMessage(input);
      expect(text).not.toContain("נרשם:");
      expect(text).not.toContain("הושלם");
    }
  });
});

// ---------------------------------------------------------------------------
// No internal vocabulary reaches the screen
// ---------------------------------------------------------------------------

describe("operator-visible text carries no internal domain terms", () => {
  /**
   * Copy WE write. Split from data we pass through, because the rule is about
   * our vocabulary: a customer reference of "CUST-4812" comes from the source
   * system and is exactly what the representative needs to quote down the
   * phone, whereas the word "coverage" in a label is us leaking how the
   * software is built.
   */
  const ourCopy = [
    ...OUTCOME_CHOICES.flatMap((c) => [c.label, c.confirmation]),
    ...contextLines(ctx({ touchCount: 3 })).map((l) => l.label),
    NO_CONTEXT_MESSAGE,
    remainingSentence(0),
    remainingSentence(1),
    remainingSentence(7),
    ...scoreboardStats(score()).flatMap((s) => [s.label, s.value]),
    scoreboardSummary(score()) ?? "",
    scoreboardSummary(score({ expiredUnworkedCount: 0, expiredUnworkedValue: 0 })) ?? "",
    outcomeErrorMessage(new Error("שגיאה")),
    outcomeErrorMessage(new Error("")),
  ];

  /** Everything rendered, including values that originate upstream. */
  const everyVisibleString = [
    ...ourCopy,
    ...contextLines(ctx({ touchCount: 3 })).map((l) => l.value),
  ];

  it("contains none of the forbidden terms, including in pass-through values", () => {
    for (const text of everyVisibleString) {
      const found = containsForbiddenTerm(text);
      expect(found, `"${text}" contains "${found}"`).toBeNull();
    }
  });

  it("uses no Latin words in copy we write", () => {
    // The strongest form of the rule, applied where it belongs: a
    // representative's screen is Hebrew. Digits, ₪ and punctuation are fine.
    for (const text of ourCopy) {
      expect(text, `"${text}" contains Latin letters`).not.toMatch(/[A-Za-z]{2,}/);
    }
  });

  it("keeps the forbidden list aligned with the real internal vocabulary", () => {
    for (const term of ["outcome", "coverage", "assignment", "scope", "work item"]) {
      expect(FORBIDDEN_UI_TERMS).toContain(term);
    }
  });

  it("finds a term when one is present, so the guard is not vacuous", () => {
    expect(containsForbiddenTerm("Coverage for this scope")).toBe("coverage");
    expect(containsForbiddenTerm("הלקוח הבא")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The screen itself
// ---------------------------------------------------------------------------

describe("operator screen source", () => {
  const source = readFileSync(
    path.resolve(import.meta.dirname, "../../routes/_authenticated/worklist.tsx"),
    "utf8",
  );

  it("renders one item at a time, never a list of customers", () => {
    // The look-ahead is reasons only — no names, no values, no buttons — so a
    // representative cannot pick out of order.
    expect(source).toContain("result.next");
    expect(source).not.toMatch(/items\.map\(/);
  });

  it("advances only on success, and re-fetches before showing the next customer", () => {
    expect(source).toContain("onSuccess");
    expect(source).toContain("await Promise.all");
    expect(source).toContain("invalidateQueries");
  });

  it("shows an error and does NOT advance on failure", () => {
    expect(source).toContain("onError");
    expect(source).toContain("setErrorText(outcomeErrorMessage(error))");
    // No invalidation in the error path — that would move the list on.
    const onError = source.slice(
      source.indexOf("onError:"),
      source.indexOf("});", source.indexOf("onError:")),
    );
    expect(onError).not.toContain("invalidateQueries");
  });

  it("has a Hebrew empty state for an empty queue", () => {
    expect(source).toContain("אין לקוחות ממתינים");
  });

  it("is explicitly RTL", () => {
    expect(source).toContain('dir="rtl"');
  });
});
