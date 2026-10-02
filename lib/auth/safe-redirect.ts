/**
 * Only allow same-origin relative paths after login (prevents open redirect).
 * Rejects absolute URLs, protocol-relative (`//evil.com`), backslash tricks
 * (`/\evil.com`), control chars and non-string input.
 */
export function safeRedirectPath(input: string | null | undefined, fallback = "/"): string {
  if (typeof input !== "string" || input.length === 0 || input.length > 2048) return fallback;
  if (!input.startsWith("/")) return fallback;
  if (input.startsWith("//") || input.startsWith("/\\")) return fallback;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\\]/.test(input)) return fallback;
  try {
    const u = new URL(input, "http://local.invalid");
    if (u.origin !== "http://local.invalid") return fallback;
  } catch {
    return fallback;
  }
  return input;
}
