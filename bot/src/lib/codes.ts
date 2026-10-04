import { randomBytes } from "crypto";
import { vnDate } from "./time";

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** PREFIX-YYYYMMDD-XXXXXXXX (VN date, crypto random suffix). Uniqueness is enforced by the DB; callers retry on 23505. */
export function generateCode(prefix: string, now: Date = new Date()): string {
  let r = "";
  for (const b of randomBytes(8)) r += ALPHABET[b % 32];
  return `${prefix}-${vnDate(now).replace(/-/g, "")}-${r}`;
}
