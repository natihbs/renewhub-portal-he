import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  applyGeneratedDecision,
  generateCoaching,
  generateCompetition,
  generateCongrats,
  generateEvening,
  generateListening,
  generateMorning,
  generationSignature,
} from "@/routes/_authenticated/communications";

// ---------------------------------------------------------------------------
// /communications crash regression: Generator used to call setState DURING
// RENDER behind an object-identity comparison (`generated !== lastGenerated`).
// `inputs` is a fresh object whenever any upstream query settles, so the
// comparison fired on unrelated re-renders and looped until the page error
// boundary tripped ("אירעה שגיאה בטעינת הדף"). The fix: a primitive content
// signature (kind, seed, rep, listening, title, body) applied inside a
// useEffect — render never calls setState, and object identity is irrelevant.
// ---------------------------------------------------------------------------

const src = readFileSync(
  resolve(__dirname, "../../routes/_authenticated/communications.tsx"),
  "utf8",
);
const generatorSrc = src.slice(
  src.indexOf("function Generator()"),
  src.indexOf("function WhatsAppPreview"),
);
const effectStart = generatorSrc.indexOf("useEffect(() => {");
const effectEnd = generatorSrc.indexOf("]);", effectStart);
const effectSrc = generatorSrc.slice(effectStart, effectEnd);
const outsideEffect = generatorSrc.slice(0, effectStart) + generatorSrc.slice(effectEnd);

describe("source pin — no setState during render in Generator", () => {
  it("the render-time identity-compare block is gone", () => {
    expect(generatorSrc).not.toContain("lastGenerated");
    expect(generatorSrc).not.toContain("generated !==");
    expect(generatorSrc).not.toContain("inputs !==");
  });

  it("the generated draft is applied inside a useEffect, and only there", () => {
    expect(effectStart).toBeGreaterThan(-1);
    expect(effectSrc).toContain("setBody(generated.body)");
    expect(effectSrc).toContain("setTitle(generated.title)");
    expect(outsideEffect).not.toContain("setBody(generated.body)");
    expect(outsideEffect).not.toContain("setTitle(generated.title)");
  });

  it("every setState call outside the effect lives in an arrow-function handler, never in render flow", () => {
    // A setState call executed during render appears as a bare statement; a
    // handler call is always inside an inline arrow. Check the immediate
    // context of every remaining setBody/setTitle/setDirty call site.
    for (const call of ["setBody(", "setTitle(", "setDirty("]) {
      let from = 0;
      for (;;) {
        const at = outsideEffect.indexOf(call, from);
        if (at === -1) break;
        const context = outsideEffect.slice(Math.max(0, at - 60), at);
        expect(context, `${call} at offset ${at} must sit inside an arrow function`).toMatch(/=>/);
        from = at + call.length;
      }
    }
  });

  it("the effect keys on the primitive signature — kind, seed, rep, listening, title, body", () => {
    expect(generatorSrc).toContain("generationSignature({");
    expect(generatorSrc).toContain("repId: effectiveRepId");
    expect(generatorSrc).toContain("listeningId: effectiveListeningId");
    expect(generatorSrc).toContain("title: generated.title");
    expect(generatorSrc).toContain("body: generated.body");
    expect(effectSrc).toContain("applyGeneratedDecision({");
    expect(generatorSrc).toContain(
      "}, [generatedSignature, dirty, generated.title, generated.body]);",
    );
  });
});

describe("generationSignature — content equality, never object identity", () => {
  const args = {
    kind: "morning",
    seed: 0,
    repId: "r1",
    listeningId: "f1",
    title: "עדכון בוקר",
    body: "שלום לכולם",
  };

  it("two independently constructed argument objects with equal values produce the same signature", () => {
    expect(generationSignature({ ...args })).toBe(generationSignature({ ...args }));
  });

  it("changes when any of kind, seed, rep, listening, title or body changes", () => {
    const base = generationSignature(args);
    expect(generationSignature({ ...args, kind: "evening" })).not.toBe(base);
    expect(generationSignature({ ...args, seed: 1 })).not.toBe(base);
    expect(generationSignature({ ...args, repId: "r2" })).not.toBe(base);
    expect(generationSignature({ ...args, listeningId: "f2" })).not.toBe(base);
    expect(generationSignature({ ...args, title: "אחר" })).not.toBe(base);
    expect(generationSignature({ ...args, body: "אחר" })).not.toBe(base);
  });

  it("field boundaries cannot collide — 'a b'+'c' is not 'a'+'b c'", () => {
    expect(generationSignature({ ...args, title: "a b", body: "c" })).not.toBe(
      generationSignature({ ...args, title: "a", body: "b c" }),
    );
  });
});

describe("applyGeneratedDecision — auto-update rules and loop termination", () => {
  it("changed content with dirty=false is recorded and applied", () => {
    expect(
      applyGeneratedDecision({ nextSignature: "b", appliedSignature: "a", dirty: false }),
    ).toEqual({ record: true, apply: true });
  });

  it("changed content while the user has edited (dirty=true) is recorded but never overwrites the draft", () => {
    expect(
      applyGeneratedDecision({ nextSignature: "b", appliedSignature: "a", dirty: true }),
    ).toEqual({ record: true, apply: false });
  });

  it("no infinite re-render pattern: once recorded, the same signature is a strict no-op", () => {
    let applied = "a";
    const first = applyGeneratedDecision({
      nextSignature: "b",
      appliedSignature: applied,
      dirty: false,
    });
    if (first.record) applied = "b";
    // The re-render the apply itself triggers evaluates again — and must stop.
    const second = applyGeneratedDecision({
      nextSignature: "b",
      appliedSignature: applied,
      dirty: false,
    });
    expect(second).toEqual({ record: false, apply: false });
    // And stays a no-op no matter how often unrelated renders re-run it.
    for (let i = 0; i < 100; i++) {
      expect(
        applyGeneratedDecision({ nextSignature: "b", appliedSignature: applied, dirty: false })
          .apply,
      ).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Generation with a fully loaded dataset: reps with official goals, teams,
// an active competition with a leaderboard, and listening feedback.
// ---------------------------------------------------------------------------

type Inputs = Parameters<typeof generateMorning>[0];

const rep = (id: string, name: string, currentResult: number, target: number | null) => ({
  id,
  name,
  teamId: "t1",
  teamName: "חידושי רכב",
  currentResult,
  target,
  pct: target === null ? null : Math.round((currentResult / target) * 1000) / 10,
});

const loadedInputs = (): Inputs => {
  const reps = [
    rep("r1", "דנה לוי", 120, 100),
    rep("r2", "יוסי כהן", 60, 100),
    rep("r3", "נעם בר", 50, null),
  ];
  const targeted = reps.filter((r) => r.pct !== null);
  return {
    reps,
    teams: [{ teamId: "t1", teamName: "חידושי רכב", target: 200, result: 230, pct: 115, count: 3 }],
    overall: 115,
    totalResult: 230,
    totalTarget: 200,
    above: targeted.filter((r) => (r.pct as number) >= 100),
    below: targeted.filter((r) => (r.pct as number) < 80),
    onPace: [],
    top: targeted,
    missingTargetCount: 1,
    activeComp: {
      id: "c1",
      name: "ספרינט אוגוסט",
      prize: "ארוחת צוות",
      endDate: "2026-08-31",
      active: true,
    },
    leaderboard: [
      { name: "דנה לוי", total: 42 },
      { name: "יוסי כהן", total: 30 },
    ],
    listeningsThisWeek: [
      {
        id: "f1",
        repId: "r2",
        date: "2026-08-05",
        score: 84,
        keep: "פתיחה מצוינת",
        improve: "הצעת שדרוג",
        nextTask: "תרגול התנגדויות",
        managerSummary: "מגמה חיובית",
      },
    ],
    workdaysLeft: 16,
    renewalTeams: [],
  } as unknown as Inputs;
};

describe("generators produce complete content from loaded reps, goals, competition and feedback", () => {
  it("every kind returns a non-empty title and body without throwing", () => {
    const i = loadedInputs();
    const all = [
      generateMorning(i),
      generateEvening(i),
      generateCompetition(i, 0),
      generateCongrats(i, "r1"),
      generateCoaching(i, "r2"),
      generateListening(i, "f1"),
    ];
    for (const g of all) {
      expect(g.title.length).toBeGreaterThan(0);
      expect(g.body.length).toBeGreaterThan(0);
    }
  });

  it("the loaded data actually flows through — team, competition, rep and listening details appear", () => {
    const i = loadedInputs();
    expect(generateMorning(i).body).toContain("חידושי רכב");
    expect(generateCompetition(i, 0).body).toContain("ספרינט אוגוסט");
    expect(generateCongrats(i, "r1").body).toContain("דנה לוי");
    expect(generateListening(i, "f1").body).toContain("84/100");
  });

  it("changing kind changes the signature — so with dirty=false the draft auto-updates", () => {
    const i = loadedInputs();
    const base = { seed: 0, repId: "r1", listeningId: "f1" };
    const morning = generateMorning(i);
    const evening = generateEvening(i);
    const sigMorning = generationSignature({ ...base, kind: "morning", ...morning });
    const sigEvening = generationSignature({ ...base, kind: "evening", ...evening });
    expect(sigEvening).not.toBe(sigMorning);
    expect(
      applyGeneratedDecision({
        nextSignature: sigEvening,
        appliedSignature: sigMorning,
        dirty: false,
      }),
    ).toEqual({ record: true, apply: true });
  });

  it("a data refresh that regenerates identical content never touches a manually edited draft", () => {
    const i1 = loadedInputs();
    const i2 = loadedInputs(); // fresh object tree — same values
    const base = { kind: "morning", seed: 0, repId: "r1", listeningId: "f1" };
    const sig1 = generationSignature({ ...base, ...generateMorning(i1) });
    const sig2 = generationSignature({ ...base, ...generateMorning(i2) });
    // Identical content from distinct objects: no change detected at all.
    expect(sig2).toBe(sig1);
    expect(
      applyGeneratedDecision({ nextSignature: sig2, appliedSignature: sig1, dirty: true }),
    ).toEqual({
      record: false,
      apply: false,
    });
    // And even genuinely changed content is only recorded, never applied, while dirty.
    expect(
      applyGeneratedDecision({ nextSignature: "changed", appliedSignature: sig1, dirty: true })
        .apply,
    ).toBe(false);
  });
});
