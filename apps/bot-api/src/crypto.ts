import { createHash, randomBytes, randomUUID } from "node:crypto";

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export const sha256 = (input: string): string =>
  createHash("sha256").update(input).digest("hex");

export const randomToken = (): string => randomBytes(32).toString("hex");

export const uuid = (): string => randomUUID();

export function displayCode(length = 6): string {
  const bytes = randomBytes(length);
  let code = "";
  for (const byte of bytes) code += CODE_ALPHABET[byte % CODE_ALPHABET.length];
  return code;
}

export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}
