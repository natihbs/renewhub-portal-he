import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  AI_INSIGHT_FRIENDLY_ERROR,
  NO_DATA_INSIGHT,
  mapInsightKeys,
  normalizeInsightResult,
  parseInsightFallback,
} from "@/lib/ai-insights-domain";

// ---------------------------------------------------------------------------
// AI insights empty-output hardening. Live QA after PR #36: generation
// "succeeded" but rendered a blank סיכום card, "לא זוהו ממצאים עיקריים" and
// "לא הופקו המלצות". A blank object must never be a successful insight:
// normalizeInsightResult is the single quality gate — applied after
// generation on the server, on every fallback parse, and again in the UI.
// ---------------------------------------------------------------------------

const read = (rel: string) => readFileSync(resolve(__dirname, rel), "utf8");
const aiFnsSrc = read("../ai-insights.functions.ts");
const aiPageSrc = read("../../routes/_authenticated/ai-insights.tsx");

const usableResult = {
  summary: "  ביצוע טוב החודש  ",
  keyFindings: [
    { title: " עמידה ביעד ", description: " 105% מהיעד " },
    { title: "", description: "" },
  ],
  recommendations: [
    { action: " לשמור על הקצב ", priority: "", rationale: " הקצב הנוכחי מספיק " },
    { action: "   ", priority: "high", rationale: "בלי פעולה אין המלצה" },
  ],
};

// ------------------------------------------------- normalizeInsightResult
describe("normalizeInsightResult — the quality gate", () => {
  it("the exact live-QA blank object is rejected, never a success", () => {
    expect(
      normalizeInsightResult({ summary: "", keyFindings: [], recommendations: [] }),
    ).toBeNull();
  });

  it("objects where every field is blank are rejected", () => {
    expect(
      normalizeInsightResult({
        summary: "   ",
        keyFindings: [{ title: " ", description: "" }],
        recommendations: [{ action: "", priority: "", rationale: " " }],
      }),
    ).toBeNull();
  });

  it("non-objects are rejected", () => {
    expect(normalizeInsightResult(undefined)).toBeNull();
    expect(normalizeInsightResult(null)).toBeNull();
    expect(normalizeInsightResult("text")).toBeNull();
    expect(normalizeInsightResult([])).toBeNull();
  });

  it("a summary is mandatory — findings without a summary do not pass", () => {
    expect(
      normalizeInsightResult({
        summary: "",
        keyFindings: [{ title: "ממצא", description: "תיאור" }],
        recommendations: [],
      }),
    ).toBeNull();
  });

  it("trims every field and drops blank findings/recommendations", () => {
    expect(normalizeInsightResult(usableResult)).toEqual({
      summary: "ביצוע טוב החודש",
      keyFindings: [{ title: "עמידה ביעד", description: "105% מהיעד" }],
      recommendations: [
        { action: "לשמור על הקצב", priority: "medium", rationale: "הקצב הנוכחי מספיק" },
      ],
    });
  });

  it("a real summary with empty arrays is usable — the summary itself is the content", () => {
    expect(
      normalizeInsightResult({
        summary: "אין מספיק משובים כדי לזהות דפוס — נדרשים לפחות שלושה משובים.",
        keyFindings: [],
        recommendations: [],
      }),
    ).toMatchObject({ keyFindings: [], recommendations: [] });
  });
});

// --------------------------------------------------- fallback parsing
describe("parseInsightFallback — no silent blank success", () => {
  it("unknown-key JSON is rejected, not converted into an empty success", () => {
    expect(parseInsightFallback('{"foo": "bar", "baz": [1, 2]}')).toBeNull();
  });

  it("the live-QA empty object is rejected in the fallback path too", () => {
    expect(
      parseInsightFallback('{"summary": "", "keyFindings": [], "recommendations": []}'),
    ).toBeNull();
  });

  it("Hebrew-key JSON is intentionally mapped into real content — never blanked", () => {
    const result = parseInsightFallback(
      JSON.stringify({
        סיכום: "התקדמות יפה מול היעד",
        ממצאים: [{ כותרת: "עמידה ביעד", תיאור: "מעל 100%" }],
        המלצות: [{ פעולה: "לשמור על הקצב", עדיפות: "medium", נימוק: "הקצב מספיק" }],
      }),
    );
    expect(result).toEqual({
      summary: "התקדמות יפה מול היעד",
      keyFindings: [{ title: "עמידה ביעד", description: "מעל 100%" }],
      recommendations: [{ action: "לשמור על הקצב", priority: "medium", rationale: "הקצב מספיק" }],
    });
  });

  it("Hebrew-key JSON with blank content is still rejected", () => {
    expect(parseInsightFallback('{"סיכום": "", "ממצאים": [], "המלצות": []}')).toBeNull();
  });

  it("meaningful plain prose becomes a summary-only result", () => {
    const prose = "הביצוע החודש עומד על 95% מהיעד, עם מגמת שיפור עקבית בשבועיים האחרונים.";
    expect(parseInsightFallback(prose)).toEqual({
      summary: prose,
      keyFindings: [],
      recommendations: [],
    });
  });

  it("empty, too-short or broken-JSON text is rejected", () => {
    expect(parseInsightFallback(undefined)).toBeNull();
    expect(parseInsightFallback("")).toBeNull();
    expect(parseInsightFallback("קצר")).toBeNull();
    expect(parseInsightFallback('{"summary": "בר')).toBeNull();
  });

  it("mapInsightKeys leaves unknown keys unmapped — rejection stays the default", () => {
    expect(normalizeInsightResult(mapInsightKeys({ something: "else" }))).toBeNull();
  });
});

// --------------------------------------------------- deliberate no-data
describe("NO_DATA_INSIGHT — deliberate, honest Hebrew content", () => {
  it("carries the required copy and passes its own quality gate", () => {
    expect(NO_DATA_INSIGHT.summary).toBe("אין כרגע מספיק נתונים כדי להפיק תובנה אמינה.");
    expect(NO_DATA_INSIGHT.keyFindings[0].title).toBe("חסרים נתונים");
    expect(NO_DATA_INSIGHT.recommendations[0].action).toBe("להמשיך לצבור נתונים");
    expect(normalizeInsightResult(NO_DATA_INSIGHT)).toEqual(NO_DATA_INSIGHT);
  });

  it("is returned only for a scope with genuinely no data; real data + empty output throws the retryable error", () => {
    const gen = aiFnsSrc.slice(
      aiFnsSrc.indexOf("async function generateInsight"),
      aiFnsSrc.indexOf("function formatPerformancePrompt"),
    );
    expect(gen).toContain("const usable = normalizeInsightResult(output);");
    expect(gen).toContain("if (usable) return usable;");
    expect(gen).toContain("if (!hasData) return NO_DATA_INSIGHT;");
    expect(gen).toContain("throw new Error(AI_INSIGHT_FRIENDLY_ERROR);");
    // hasData comes from the real visible rows of each prompt scope.
    expect(aiFnsSrc).toContain("hasData: rows.length > 0");
    expect(aiFnsSrc).toContain("hasData: visibleFeedback.length > 0");
    expect(aiFnsSrc).toContain("hasData: visibleReps.length > 0");
  });
});

// --------------------------------------------------- prompt robustness
describe("prompt robustness — the user prompt is self-contained", () => {
  it("the JSON contract names every required English key inside the USER prompt", () => {
    const contract = aiFnsSrc.slice(
      aiFnsSrc.indexOf("export const PROMPT_JSON_CONTRACT"),
      aiFnsSrc.indexOf("async function generateInsight"),
    );
    for (const key of [
      '"summary"',
      '"keyFindings"',
      '"recommendations"',
      '"title"',
      '"description"',
      '"action"',
      '"priority"',
      '"rationale"',
    ]) {
      expect(contract).toContain(key);
    }
    // Appended to all three prompt builders.
    expect(aiFnsSrc.split("...PROMPT_JSON_CONTRACT").length - 1).toBe(3);
  });

  it("strict structured outputs are enabled on the gateway provider", () => {
    expect(aiFnsSrc).toContain(
      "createLovableAiGatewayProvider(key, undefined, { structuredOutputs: true })",
    );
  });

  it("the invalid-prompt regression stays fixed: no system role, instructions via provider options", () => {
    expect(aiFnsSrc).not.toContain('role: "system"');
    expect(aiFnsSrc).toContain("providerOptions: { lovable: { instructions } }");
  });

  it("representative prompts ask for the personal analysis explicitly", () => {
    expect(aiFnsSrc).toContain("אחוז עמידה, פער ליעד וקצב נדרש");
    expect(aiFnsSrc).toContain("סכם את הדפוסים החוזרים במשובים שפורסמו עבורו");
    expect(aiFnsSrc).toContain("תן 1-3 המלצות מעשיות לשיפור לקראת החודש הבא");
    expect(aiFnsSrc).toContain("ציין זאת במפורש בעברית והצע צעד מעשי אחד להמשך");
  });

  it("representative scope remains personal only", () => {
    expect(aiFnsSrc).toContain('scope.role === "representative" && scope.repId');
    expect(aiFnsSrc).toContain('from("user_roles")');
  });
});

// --------------------------------------------------- UI behavior
describe("UI — never a blank success card", () => {
  it("the page validates every result before storing it, and shows the friendly error otherwise", () => {
    expect(aiPageSrc).toContain("const usable = normalizeInsightResult(result);");
    expect(aiPageSrc).toContain("if (!usable) {");
    expect(aiPageSrc).toContain(
      "setErrors((prev) => ({ ...prev, [type]: AI_INSIGHT_FRIENDLY_ERROR }))",
    );
    expect(aiPageSrc).toContain("setResults((prev) => ({ ...prev, [type]: usable }))");
    // The raw, unvalidated result is never stored.
    expect(aiPageSrc).not.toContain("[type]: result as InsightResult");
  });

  it("raw English provider errors stay hidden and the rep personalization is intact", () => {
    expect(aiPageSrc).toContain("friendlyAiInsightError(e)");
    expect(AI_INSIGHT_FRIENDLY_ERROR).toBe("לא הצלחנו ליצור תובנה כרגע. נסו שוב בעוד רגע.");
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

// --------------------------------------------------- boundaries
describe("boundaries — no role/hierarchy/worklist/CRM changes", () => {
  it("the changed files carry no worklist/queue/customer/call-outcome vocabulary", () => {
    for (const src of [aiPageSrc, read("../ai-insights-domain.ts")]) {
      for (const term of ["worklist", "call_outcome", "customer_id", "next customer"]) {
        expect(src.toLowerCase()).not.toContain(term);
      }
    }
  });
});
