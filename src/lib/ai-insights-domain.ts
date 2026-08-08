/**
 * Pure, dependency-free pieces of the AI-insights flow — kept separate from
 * ai-insights.functions.ts so they are unit-testable (the functions module
 * imports the AI SDK, which only exists in the deployed environment).
 *
 * The quality gate lives HERE, not in the wire schema: a blank object that
 * happens to match the schema's shape must never be shown as a successful
 * insight. normalizeInsightResult is the single source of truth for "is this
 * usable", applied server-side after generation, to every fallback parse, and
 * once more in the UI before rendering.
 */

/** The one user-facing failure message for insight generation. */
export const AI_INSIGHT_FRIENDLY_ERROR = "לא הצלחנו ליצור תובנה כרגע. נסו שוב בעוד רגע.";

export type InsightFinding = { title: string; description: string };
export type InsightRecommendation = { action: string; priority: string; rationale: string };
export type InsightResultShape = {
  summary: string;
  keyFindings: InsightFinding[];
  recommendations: InsightRecommendation[];
};

/**
 * The deliberate no-data answer — real Hebrew content, returned only when the
 * analyzed scope genuinely had nothing to analyze. Never a stand-in for a
 * generation failure over real data (that path throws the friendly error, so
 * the user retries instead of being told, falsely, that they have no data).
 */
export const NO_DATA_INSIGHT: InsightResultShape = {
  summary: "אין כרגע מספיק נתונים כדי להפיק תובנה אמינה.",
  keyFindings: [
    {
      title: "חסרים נתונים",
      description: "נדרשים ביצועים או משובים נוספים כדי לזהות דפוס אמין.",
    },
  ],
  recommendations: [
    {
      action: "להמשיך לצבור נתונים",
      priority: "medium",
      rationale: "ככל שיצטברו ביצועים ומשובים, התובנות יהיו מדויקות יותר.",
    },
  ],
};

/**
 * User-facing error resolution: a Hebrew message written for the user (our
 * own server-side messages) passes through; anything else — raw English
 * provider/SDK/network text like "Invalid prompt: System messages are not
 * allowed…" — is replaced by the calm Hebrew line. The technical original
 * belongs in console/server logs, never on screen as the main message.
 */
export function friendlyAiInsightError(raw: unknown): string {
  const message = raw instanceof Error ? raw.message : typeof raw === "string" ? raw : "";
  return /[֐-׿]/.test(message) ? message : AI_INSIGHT_FRIENDLY_ERROR;
}

const asTrimmed = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

/**
 * Trims every field, drops blank findings/recommendations, and answers the
 * one question that matters: is there actual content here?
 *
 * Returns null — never a blank object — when:
 *  - the value is not a plain object,
 *  - the summary is empty after trimming (a summary is mandatory: the
 *    findings/recommendations cards may legitimately be empty only under a
 *    summary that says why),
 *  - or every field in the object is blank.
 */
export function normalizeInsightResult(raw: unknown): InsightResultShape | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;

  const summary = asTrimmed(o.summary);
  const keyFindings = (Array.isArray(o.keyFindings) ? o.keyFindings : [])
    .map((f) => ({
      title: asTrimmed((f as Record<string, unknown>)?.title),
      description: asTrimmed((f as Record<string, unknown>)?.description),
    }))
    .filter((f) => f.title !== "" || f.description !== "");
  const recommendations = (Array.isArray(o.recommendations) ? o.recommendations : [])
    .map((r) => ({
      action: asTrimmed((r as Record<string, unknown>)?.action),
      priority: asTrimmed((r as Record<string, unknown>)?.priority) || "medium",
      rationale: asTrimmed((r as Record<string, unknown>)?.rationale),
    }))
    .filter((r) => r.action !== "");

  if (summary === "") return null;
  return { summary, keyFindings, recommendations };
}

/**
 * Intentional key mapping for a model that answered with the right structure
 * under the wrong names — most likely Hebrew keys, since the content language
 * is Hebrew. Anything not recognized here stays unmapped and will fail
 * normalizeInsightResult, i.e. unknown-key JSON is REJECTED, never silently
 * accepted as a blank success.
 */
export function mapInsightKeys(parsed: Record<string, unknown>): Record<string, unknown> {
  const pick = (...keys: string[]): unknown => {
    for (const key of keys) {
      if (parsed[key] !== undefined) return parsed[key];
    }
    return undefined;
  };
  const obj = (value: unknown): Record<string, unknown> =>
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};

  const findingsRaw = pick("keyFindings", "findings", "ממצאים", "ממצאים עיקריים");
  const recsRaw = pick("recommendations", "המלצות");

  return {
    summary: pick("summary", "overview", "סיכום", "תקציר"),
    keyFindings: (Array.isArray(findingsRaw) ? findingsRaw : []).map((f) => {
      const x = obj(f);
      return {
        title: x.title ?? x["כותרת"],
        description: x.description ?? x["תיאור"] ?? x["פירוט"],
      };
    }),
    recommendations: (Array.isArray(recsRaw) ? recsRaw : []).map((r) => {
      const x = obj(r);
      return {
        action: x.action ?? x["פעולה"] ?? x["המלצה"],
        priority: x.priority ?? x["עדיפות"],
        rationale: x.rationale ?? x["נימוק"] ?? x["הסבר"],
      };
    }),
  };
}

/**
 * Last-resort parse of the raw model text after a NoObjectGeneratedError.
 *
 *  - JSON with recognized (or intentionally mapped Hebrew) keys → normalized,
 *    and returned only if it carries real content.
 *  - JSON with unknown keys → null. The old implementation turned this case
 *    into { summary: "", keyFindings: [], recommendations: [] } — a blank
 *    "success" — which is exactly the bug this module exists to prevent.
 *  - Plain prose → used as a summary only when it is non-empty and long
 *    enough to be meaningful, and clearly not a broken JSON fragment.
 */
export function parseInsightFallback(text: string | undefined): InsightResultShape | null {
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return normalizeInsightResult(mapInsightKeys(parsed as Record<string, unknown>));
    }
    return null;
  } catch {
    // not JSON — fall through to the prose path
  }
  const plain = text.trim();
  if (plain.length >= 20 && !plain.startsWith("{") && !plain.startsWith("[")) {
    return { summary: plain.slice(0, 500), keyFindings: [], recommendations: [] };
  }
  return null;
}
