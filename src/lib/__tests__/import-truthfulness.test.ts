import { describe, it, expect } from "vitest";
import { autoMap, PERSISTED_FIELDS, RENEWAL_FIELDS, UNSUPPORTED_FIELDS, REQUIRED_FIELDS, FIELD_LABEL, type ImportFieldKey } from "@/lib/import-store";

// Regression coverage: the import mapping UI used to offer fields that were
// accepted, validated, and then silently dropped before the cloud write. Every
// real field must now fall into exactly one of three explicit categories:
// unconditionally persisted (PERSISTED_FIELDS), conditionally persisted only for a
// renewals-profile team (RENEWAL_FIELDS), or clearly marked unsupported
// (UNSUPPORTED_FIELDS) — never a silent fourth case.

describe("import field truthfulness", () => {
  it("PERSISTED_FIELDS, RENEWAL_FIELDS and UNSUPPORTED_FIELDS are disjoint and together cover every real field", () => {
    for (const f of PERSISTED_FIELDS) {
      expect(UNSUPPORTED_FIELDS).not.toContain(f);
      expect(RENEWAL_FIELDS).not.toContain(f);
    }
    for (const f of RENEWAL_FIELDS) {
      expect(UNSUPPORTED_FIELDS).not.toContain(f);
    }
    const allRealFields = (Object.keys(FIELD_LABEL) as ImportFieldKey[]).filter((f) => f !== "__skip__");
    for (const f of allRealFields) {
      expect(PERSISTED_FIELDS.includes(f) || RENEWAL_FIELDS.includes(f) || UNSUPPORTED_FIELDS.includes(f)).toBe(true);
    }
  });

  it("every required field is a persisted field", () => {
    for (const f of REQUIRED_FIELDS) {
      expect(PERSISTED_FIELDS).toContain(f);
    }
  });

  it("every unsupported field's label visibly says so", () => {
    for (const f of UNSUPPORTED_FIELDS) {
      expect(FIELD_LABEL[f]).toContain("לא נשמר");
    }
  });

  it("auto-mapping never assigns a column to an unsupported field, even when the header text matches its keywords", () => {
    const headers = ["שם הנציג", "צוות", "יעד חודשי", "ביצוע נוכחי", "תאריך עדכון", "מספר האזנות", "איחורים", "זמן דיבור", "אחוז שדרוגים"];
    const map = autoMap(headers);
    for (const field of Object.values(map)) {
      expect(UNSUPPORTED_FIELDS).not.toContain(field);
    }
    // the required columns still resolve correctly
    expect(map["שם הנציג"]).toBe("name");
    expect(map["יעד חודשי"]).toBe("monthlyTarget");
    // an unsupported-looking column is left unmapped (skipped) rather than silently assigned
    expect(map["מספר האזנות"]).toBe("__skip__");
    expect(map["איחורים"]).toBe("__skip__");
  });
});
