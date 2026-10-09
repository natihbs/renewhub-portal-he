import { copyText } from "./clipboard";

export const SHARE_TITLE = "MINDTRAP · EXPERIMENT 001";
export const SHARE_TEXT = "ניסוי 001: ארבע החלטות, תחזית אחת שנחתמה לפני שבחרתי. ניסיתי לשנות אותה. תורך.";

export type ShareOutcome = "shared" | "copied" | "cancelled" | "failed";

/** Shares the experiment URL with a teaser. Never includes the prediction. */
export async function shareExperiment(url: string): Promise<ShareOutcome> {
  if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
    try {
      await navigator.share({ title: SHARE_TITLE, text: SHARE_TEXT, url });
      return "shared";
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return "cancelled";
      // Fall back to copying below.
    }
  }
  return (await copyText(`${SHARE_TEXT}\n${url}`)) ? "copied" : "failed";
}
