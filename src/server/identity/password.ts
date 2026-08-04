import { hash, verify } from "@node-rs/argon2";

// OWASP-recommended minimum for Argon2id on an interactive login path.
const HASH_OPTIONS = {
  memoryCost: 19456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
};

export function hashPassword(password: string): Promise<string> {
  return hash(password, HASH_OPTIONS);
}

export async function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    // Malformed/foreign hash format — treat as a failed verification, not a crash.
    return false;
  }
}
