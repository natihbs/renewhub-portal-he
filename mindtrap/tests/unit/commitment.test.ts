import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  DOMAIN_TAG,
  PREDICTION,
  createCommitment,
  serialize,
  sha256Hex,
  shortHash,
  verifyCommitment,
} from "@/lib/commitment";

describe("commitment", () => {
  it("uses the prediction '34'", () => {
    expect(PREDICTION).toBe("34");
  });

  it("serializes unambiguously", () => {
    expect(serialize("34", "ab")).toBe(`["${DOMAIN_TAG}","34","ab"]`);
    // Shifting characters across the boundary yields a different preimage.
    expect(serialize("3", "4ab")).not.toBe(serialize("34", "ab"));
  });

  it("matches an independent SHA-256 implementation", async () => {
    const input = serialize("34", "00ff");
    expect(await sha256Hex(input)).toBe(createHash("sha256").update(input, "utf8").digest("hex"));
  });

  it("creates a commitment that verifies", async () => {
    const c = await createCommitment();
    expect(c.prediction).toBe("34");
    expect(c.nonce).toMatch(/^[0-9a-f]{64}$/);
    expect(c.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(await verifyCommitment(c.prediction, c.nonce, c.hash)).toBe(true);
    expect(await verifyCommitment(c.prediction, c.nonce, c.hash.toUpperCase())).toBe(true);
  });

  it("uses a fresh random nonce every time", async () => {
    const [a, b] = await Promise.all([createCommitment(), createCommitment()]);
    expect(a.nonce).not.toBe(b.nonce);
    expect(a.hash).not.toBe(b.hash);
  });

  it("fails when the prediction is modified", async () => {
    const c = await createCommitment();
    for (const p of ["35", "33", "34 ", " 34", "", "340"]) {
      expect(await verifyCommitment(p, c.nonce, c.hash)).toBe(false);
    }
  });

  it("fails when the nonce is modified", async () => {
    const c = await createCommitment();
    const flipped = (c.nonce[0] === "0" ? "1" : "0") + c.nonce.slice(1);
    expect(await verifyCommitment(c.prediction, flipped, c.hash)).toBe(false);
    expect(await verifyCommitment(c.prediction, c.nonce.slice(1), c.hash)).toBe(false);
    expect(await verifyCommitment(c.prediction, "", c.hash)).toBe(false);
  });

  it("fails against a different hash", async () => {
    const c = await createCommitment();
    expect(await verifyCommitment(c.prediction, c.nonce, "0".repeat(64))).toBe(false);
    expect(await verifyCommitment(c.prediction, c.nonce, c.hash.slice(2))).toBe(false);
  });

  it("shortens hashes for display", () => {
    expect(shortHash("a".repeat(28) + "b".repeat(36))).toBe("aaaaaaaa…bbbbbbbb");
  });
});
