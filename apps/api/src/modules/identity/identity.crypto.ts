import { createHash, randomBytes } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

// argon2id is the library default; parameters per docs/security/authentication.md.
const ARGON2_OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

export function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  return verify(passwordHash, password);
}

let dummyHash: Promise<string> | undefined;

/** Spends the same time as a real check, so unknown emails cannot be told apart by response time. */
export async function verifyAgainstDummy(password: string): Promise<void> {
  dummyHash ??= hashPassword(randomBytes(32).toString("hex"));
  await verify(await dummyHash, password);
}

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** 32 random bytes as base64url; only the SHA-256 hash is stored. */
export function createSessionToken(): { token: string; tokenHash: Buffer } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: createHash("sha256").update(token).digest() };
}

/** Returns null for anything that is not a well-formed session token. */
export function hashSessionToken(token: string | undefined): Buffer | null {
  if (token === undefined || !TOKEN_PATTERN.test(token)) return null;
  return createHash("sha256").update(token).digest();
}
