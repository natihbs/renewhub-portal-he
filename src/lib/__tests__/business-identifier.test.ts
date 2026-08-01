import { describe, it, expect } from "vitest";
import { resolveBusinessIdentifier } from "@/lib/team-admin.functions";

// Regression coverage for: "the Team Details member card shows the database
// uuid under the person's name." Root cause was rendering
// profiles.representative_id directly — that column holds the linked
// representative's uuid (despite being typed `text`), not a business code.

describe("resolveBusinessIdentifier — never falls back to a raw id", () => {
  it("prefers employee number over everything else", () => {
    const id = resolveBusinessIdentifier({
      employeeNumber: "EMP-42",
      representativeCode: "REP-7",
      email: "a@b.com",
      externalRef: "ext-1",
    });
    expect(id).toBe("EMP-42");
  });

  it("falls back to representative code when no employee number", () => {
    const id = resolveBusinessIdentifier({
      employeeNumber: null,
      representativeCode: "REP-7",
      email: "a@b.com",
      externalRef: "ext-1",
    });
    expect(id).toBe("REP-7");
  });

  it("falls back to email when no employee number or representative code", () => {
    const id = resolveBusinessIdentifier({ email: "a@b.com", externalRef: "ext-1" });
    expect(id).toBe("a@b.com");
  });

  it("falls back to external_ref when no employee number, code, or email", () => {
    const id = resolveBusinessIdentifier({ email: null, externalRef: "ext-1" });
    expect(id).toBe("ext-1");
  });

  it("falls back to the Hebrew placeholder when nothing is available — never a raw id", () => {
    const id = resolveBusinessIdentifier({});
    expect(id).toBe("ללא מזהה עסקי");
  });

  it("treats blank/whitespace-only values as absent", () => {
    const id = resolveBusinessIdentifier({ employeeNumber: "   ", email: "  ", externalRef: "ext-1" });
    expect(id).toBe("ext-1");
  });
});
