/**
 * Pure, dependency-free pieces of the AI-insights flow — kept separate from
 * ai-insights.functions.ts so they are unit-testable (the functions module
 * imports the AI SDK, which only exists in the deployed environment).
 */

/** The one user-facing failure message for insight generation. */
export const AI_INSIGHT_FRIENDLY_ERROR = "לא הצלחנו ליצור תובנה כרגע. נסו שוב בעוד רגע.";

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
