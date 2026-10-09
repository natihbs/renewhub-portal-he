/**
 * Hash commitment for the sealed prediction.
 *
 * commitment = SHA-256( JSON.stringify(["MINDTRAP/EXP-001/v1", prediction, nonce]) )
 *
 * A JSON array with a fixed domain tag is an unambiguous serialization: the
 * boundary between prediction and nonce can't be shifted to forge a match.
 * This proves the prediction was fixed before the reveal *within this
 * session*. It is not a trusted timestamp for outside observers.
 */

export const PREDICTION = "34";
export const DOMAIN_TAG = "MINDTRAP/EXP-001/v1";
export const NONCE_BYTES = 32;

export interface Commitment {
  /** Short human label to tell sessions apart. */
  readonly sessionId: string;
  readonly prediction: string;
  /** Hex-encoded random nonce. */
  readonly nonce: string;
  /** Hex-encoded SHA-256 of serialize(prediction, nonce). */
  readonly hash: string;
  readonly createdAt: number;
}

function cryptoApi(): Crypto {
  const c = globalThis.crypto;
  if (!c?.getRandomValues || !c.subtle) {
    throw new Error("Web Crypto API is unavailable (a secure HTTPS context is required).");
  }
  return c;
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function randomHex(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  cryptoApi().getRandomValues(bytes);
  return toHex(bytes);
}

export function serialize(prediction: string, nonce: string): string {
  return JSON.stringify([DOMAIN_TAG, prediction, nonce]);
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await cryptoApi().subtle.digest("SHA-256", new TextEncoder().encode(input));
  return toHex(new Uint8Array(digest));
}

export async function createCommitment(prediction: string = PREDICTION): Promise<Commitment> {
  const nonce = randomHex(NONCE_BYTES);
  const hash = await sha256Hex(serialize(prediction, nonce));
  return {
    sessionId: `S-${randomHex(2).toUpperCase()}`,
    prediction,
    nonce,
    hash,
    createdAt: Date.now(),
  };
}

export async function verifyCommitment(prediction: string, nonce: string, hash: string): Promise<boolean> {
  const recomputed = await sha256Hex(serialize(prediction, nonce));
  return constantTimeEqual(recomputed, hash.trim().toLowerCase());
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function shortHash(hash: string): string {
  return `${hash.slice(0, 8)}…${hash.slice(-8)}`;
}

/** A shell one-liner anyone can run to check the commitment independently. */
export function shellVerifyCommand(prediction: string, nonce: string): string {
  return `printf '%s' '${serialize(prediction, nonce)}' | sha256sum`;
}
