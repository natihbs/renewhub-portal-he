import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  emailToIlikePattern,
  normalizeEmailInput,
  EMAIL_INVALID_MESSAGE,
  EMAIL_REQUIRED_MESSAGE,
  EMAIL_TAKEN_MESSAGE,
} from "@/lib/user-admin.functions";

// ---------------------------------------------------------------------------
// Admin email correction (live-QA: a representative created with a typo —
// odelsa@menoramovt.co.il instead of odelsa@menoramivt.co.il). Changing only
// profiles.email is not enough: the Supabase Auth login email must change
// with it, so updateUserEmail rewrites BOTH, in sync, admin-only, audited —
// and touches nothing else about the account.
// ---------------------------------------------------------------------------

const read = (rel: string) => readFileSync(resolve(__dirname, rel), "utf8");
const fnsSrc = read("../user-admin.functions.ts");
const usersPageSrc = read("../../routes/_authenticated/users.tsx");

const emailFn = fnsSrc.slice(
  fnsSrc.indexOf("export const updateUserEmail"),
  fnsSrc.indexOf("export const resetPassword"),
);

// ------------------------------------------------------------ normalization
describe("normalizeEmailInput — trim, lowercase, validate", () => {
  it("normalizes the live-QA correction to the exact target address", () => {
    expect(normalizeEmailInput("  OdelSA@MenoraMIVT.co.il  ")).toBe("odelsa@menoramivt.co.il");
  });

  it("rejects an empty email with the Hebrew error", () => {
    expect(() => normalizeEmailInput("")).toThrowError(EMAIL_REQUIRED_MESSAGE);
    expect(() => normalizeEmailInput("   ")).toThrowError(EMAIL_REQUIRED_MESSAGE);
    expect(EMAIL_REQUIRED_MESSAGE).toBe("יש להזין כתובת אימייל");
  });

  it("rejects malformed addresses", () => {
    for (const bad of ["abc", "a@b", "a b@c.com", "a@b c.com", "@x.com", "a@.com"]) {
      expect(() => normalizeEmailInput(bad)).toThrowError(EMAIL_INVALID_MESSAGE);
    }
    expect(EMAIL_INVALID_MESSAGE).toBe("כתובת האימייל אינה תקינה");
  });

  it("accepts a plain valid address unchanged", () => {
    expect(normalizeEmailInput("hen@example.co.il")).toBe("hen@example.co.il");
  });
});

// ------------------------------------------------- duplicate-check exactness
describe("emailToIlikePattern — exact, case-insensitive, no wildcard behavior", () => {
  // A faithful model of Postgres ILIKE semantics: escaped \% / \_ / \\ are
  // literals; a bare % matches any sequence and a bare _ any single char.
  function ilikeMatches(pattern: string, value: string): boolean {
    let regex = "";
    for (let i = 0; i < pattern.length; i++) {
      const ch = pattern[i];
      if (ch === "\\" && i + 1 < pattern.length) {
        regex += pattern[i + 1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        i++;
      } else if (ch === "%") {
        regex += ".*";
      } else if (ch === "_") {
        regex += ".";
      } else {
        regex += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      }
    }
    return new RegExp(`^${regex}$`, "i").test(value);
  }

  it("a plain address stays unchanged and matches itself case-insensitively", () => {
    expect(emailToIlikePattern("odelsa@menoramivt.co.il")).toBe("odelsa@menoramivt.co.il");
    expect(
      ilikeMatches(emailToIlikePattern("odelsa@menoramivt.co.il"), "OdelSA@MenoraMIVT.co.il"),
    ).toBe(true);
  });

  it('an "_" is treated literally: the exact address still matches', () => {
    expect(emailToIlikePattern("john_doe@x.com")).toBe("john\\_doe@x.com");
    expect(ilikeMatches(emailToIlikePattern("john_doe@x.com"), "john_doe@x.com")).toBe(true);
    expect(ilikeMatches(emailToIlikePattern("john_doe@x.com"), "John_Doe@X.com")).toBe(true);
  });

  it("john_doe@x.com is NOT matched by johnXdoe@x.com — no wildcard false positive", () => {
    expect(ilikeMatches(emailToIlikePattern("john_doe@x.com"), "johnxdoe@x.com")).toBe(false);
    // …whereas the unescaped pattern would have matched, which was the bug.
    expect(ilikeMatches("john_doe@x.com", "johnxdoe@x.com")).toBe(true);
  });

  it('a "%" (validator-legal) is treated literally, not as any-sequence', () => {
    expect(normalizeEmailInput("a%b@x.com")).toBe("a%b@x.com");
    expect(emailToIlikePattern("a%b@x.com")).toBe("a\\%b@x.com");
    expect(ilikeMatches(emailToIlikePattern("a%b@x.com"), "a%b@x.com")).toBe(true);
    expect(ilikeMatches(emailToIlikePattern("a%b@x.com"), "aWHATEVERb@x.com")).toBe(false);
  });
});

// ------------------------------------------------------------- server behavior
describe("updateUserEmail — admin-only, both stores in sync, nothing else moves", () => {
  it("is admin-only", () => {
    expect(emailFn).toContain("await assertAdmin(ctx)");
  });

  it("normalizes at the input boundary", () => {
    expect(emailFn).toContain("normalizeEmailInput(data.email)");
  });

  it("rejects an address already used by another profile", () => {
    expect(emailFn).toContain('.ilike("email", emailToIlikePattern(data.email))');
    expect(emailFn).toContain('.neq("id", data.user_id)');
    expect(emailFn).toContain("EMAIL_TAKEN_MESSAGE");
    expect(EMAIL_TAKEN_MESSAGE).toBe("כתובת האימייל כבר בשימוש על ידי משתמש אחר");
  });

  it("updates the Supabase Auth login email AND profiles.email together", () => {
    expect(emailFn).toContain("auth.admin.updateUserById(data.user_id, {");
    expect(emailFn).toContain("email: data.email");
    expect(emailFn).toContain("email_confirm: true");
    expect(emailFn).toContain(".update({ email: data.email })");
  });

  it("reverts the auth email if the profiles sync write fails", () => {
    expect(emailFn).toContain("email: previousEmail");
  });

  it("touches nothing else: no roles, no representative link, no password fields", () => {
    expect(emailFn).not.toContain("user_roles");
    expect(emailFn).not.toContain('from("representatives")');
    expect(emailFn).not.toContain("password");
    expect(emailFn).not.toContain("must_change");
    expect(emailFn).not.toContain(".delete(");
  });

  it("writes the user.email_updated audit entry with previous and new values", () => {
    expect(emailFn).toContain('"user.email_updated"');
    expect(emailFn).toContain("previous_email: previousEmail");
    expect(emailFn).toContain("new_email: data.email");
  });
});

// ----------------------------------------------------------------------- UI
describe("/users edit dialog — editable email with honest helper text", () => {
  it("the email field is editable and labeled אימייל", () => {
    expect(usersPageSrc).toContain("value={email} onChange={(e) => setEmail(e.target.value)}");
    expect(usersPageSrc).not.toContain('value={user.email ?? ""} disabled');
  });

  it("shows the login-address helper text", () => {
    expect(usersPageSrc).toContain("שינוי האימייל יעדכן גם את כתובת ההתחברות של המשתמש.");
  });

  it("blocks an empty email client-side and calls the dedicated server fn only on change", () => {
    expect(usersPageSrc).toContain('toast.error("יש להזין כתובת אימייל")');
    expect(usersPageSrc).toContain("emailChanged ? email.trim() : null");
    expect(usersPageSrc).toContain("updateUserEmail");
  });
});

// -------------------------------------------------------------- boundaries
describe("boundaries — no product-surface creep", () => {
  it("no CRM/worklist/queue/customer/policy/call-outcome vocabulary", () => {
    for (const term of [
      "worklist",
      "call_outcome",
      "customer_id",
      "next customer",
      "policy_number",
    ]) {
      expect(emailFn.toLowerCase()).not.toContain(term);
    }
  });
});
