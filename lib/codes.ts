import { randomBytes } from "crypto";
import { vnYmd } from "@/lib/time";

// base32 without I/L/O/U (no ambiguous characters in printed codes)
const CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * Document code PREFIX-YYYYMMDD-XXXXXXXX. Date is the Vietnam date; the suffix is 8 chars of
 * crypto randomness (32^8 ~ 1.1e12), not Math.random. Uniqueness is still enforced by the DB:
 * use `insertWithGeneratedCode` which retries on a unique violation.
 */
export function generateCode(prefix: string, now: Date = new Date()): string {
  const bytes = randomBytes(8);
  let rand = "";
  for (const b of bytes) rand += CODE_ALPHABET[b % 32];
  return `${prefix}-${vnYmd(now)}-${rand}`;
}
