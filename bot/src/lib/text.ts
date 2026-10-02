/** Telegram HTML escaping: everything user/DB-controlled that is sent with parse_mode HTML must go through esc(). */
export function esc(v: unknown): string {
  return String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Text after "/cmd" (also handles "/cmd@BotName args"). */
export function commandArgs(text: string | undefined, name: string): string {
  const t = text ?? "";
  const re = new RegExp(`^/${name}(?:@\\w+)?(?:\\s+|$)`, "i");
  return t.replace(re, "").trim();
}

/**
 * Split on whitespace, keeping "double quoted" groups together (also “smart quotes” that phone keyboards insert):
 *   /ban "Nguyen Van A" HP-1234 2  ->  ["Nguyen Van A", "HP-1234", "2"]
 * An unterminated quote swallows the rest of the line as one token.
 */
export function parseArgs(input: string): string[] {
  const out: string[] = [];
  const re = /["“”]([^"“”]*)(?:["“”]|$)|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input)) !== null) {
    const tok = (m[1] ?? m[2] ?? "").trim();
    if (tok) out.push(tok);
  }
  return out;
}

/** Strict positive integer ("5" ok; "5.5", "1e3", "-1", "0x10", "" rejected). */
export function parsePositiveInt(raw: string | undefined, max = 1_000_000): number | null {
  if (raw === undefined || !/^\d{1,9}$/.test(raw)) return null;
  const n = Number(raw);
  return n > 0 && n <= max ? n : null;
}

/** Non-negative money amount in VND ("4500000", "4500000.5"); no exponent, no separators. */
export function parseMoney(raw: string | undefined, max = 1e12): number | null {
  if (raw === undefined || !/^\d{1,13}(\.\d{1,2})?$/.test(raw)) return null;
  const n = Number(raw);
  return n >= 0 && n <= max ? n : null;
}

/**
 * Search terms are embedded in PostgREST `.or("a.ilike.%t%,b.ilike.%t%")`. Remove characters that have meaning in
 * that grammar or in LIKE so user input cannot add filters.
 */
export function sanitizeSearchTerm(input: string | null | undefined, maxLen = 64): string {
  return (input ?? "").normalize("NFC").replace(/[%_,()"'\\*:;]/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLen);
}

export function ilikeOr(columns: string[], term: string | null | undefined): string | null {
  const t = sanitizeSearchTerm(term);
  return t ? columns.map((c) => `${c}.ilike.%${t}%`).join(",") : null;
}

export const fmtVND = (n: number) => new Intl.NumberFormat("vi-VN").format(Math.round(n)) + "₫";
