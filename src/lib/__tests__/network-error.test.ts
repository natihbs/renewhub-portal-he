import { describe, expect, it } from "vitest";
import { isNetworkFailure } from "@/lib/network-error";

describe("isNetworkFailure", () => {
  it("recognizes known browser fetch-failure messages, case-insensitively", () => {
    expect(isNetworkFailure(new Error("Load failed"))).toBe(true);
    expect(isNetworkFailure(new TypeError("Failed to fetch"))).toBe(true);
    expect(isNetworkFailure(new Error("NetworkError when attempting to fetch resource."))).toBe(true);
    expect(isNetworkFailure(new Error("Network request failed"))).toBe(true);
    expect(isNetworkFailure(new Error("LOAD FAILED"))).toBe(true);
  });

  it("does not misclassify a real, well-formed server error", () => {
    expect(isNetworkFailure(new Error("לא ניתן למחוק את המשתמש: מנהל הצוות של 1 צוות/ים"))).toBe(false);
    expect(isNetworkFailure(new Error("Unauthorized: Invalid token"))).toBe(false);
    expect(isNetworkFailure(new Error("User not found"))).toBe(false);
  });

  it("rejects non-Error values instead of throwing", () => {
    expect(isNetworkFailure("Load failed")).toBe(false);
    expect(isNetworkFailure(null)).toBe(false);
    expect(isNetworkFailure(undefined)).toBe(false);
  });
});
