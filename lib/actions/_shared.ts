/**
 * Shared helpers for server actions / data access. NOT a "use server" file (it exports sync
 * functions and types); import it from actions, never call it from the client.
 */

export type ActionResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

export type PgError = { message: string; code?: string; details?: string | null } | null;

/** "" / whitespace-only -> null (form fields), everything else unchanged. */
export function emptyToNull<T>(v: T): T | null {
  if (typeof v === "string" && v.trim() === "") return null;
  return v;
}

/** Apply emptyToNull + trim to every string field of a flat object. */
export function cleanInput<T extends Record<string, unknown>>(obj: T): { [K in keyof T]: T[K] | null } {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = typeof v === "string" ? emptyToNull(v.trim()) : v;
  }
  return out as { [K in keyof T]: T[K] | null };
}

/** Thrown by `unwrap` so a failed query can never be rendered as an empty list. */
export class QueryError extends Error {
  constructor(public readonly what: string, public readonly cause_: PgError) {
    super(`${what}: ${cause_?.message ?? "unknown error"}`);
    this.name = "QueryError";
  }
}

/** Return `data` or throw QueryError (pages: let the error boundary show it instead of an empty table). */
export function unwrap<T>(res: { data: T | null; error: PgError }, what: string): T {
  if (res.error) throw new QueryError(what, res.error);
  return (res.data ?? ([] as unknown)) as T;
}

/** Like unwrap but keeps `null` (single-row lookups with maybeSingle). */
export function unwrapOne<T>(res: { data: T | null; error: PgError }, what: string): T | null {
  if (res.error) throw new QueryError(what, res.error);
  return res.data ?? null;
}

/** Convert a Postgres error to an ActionResult failure, mapping the common SQLSTATEs to Vietnamese. */
export function pgErrorMessage(error: NonNullable<PgError>): string {
  switch (error.code) {
    case "23505": return "Dữ liệu bị trùng (đã tồn tại bản ghi có cùng mã/giá trị duy nhất).";
    case "23503": return "Không thể thực hiện: bản ghi đang được dùng ở nơi khác (hoặc tham chiếu không tồn tại).";
    case "23514": return "Dữ liệu không hợp lệ (vi phạm ràng buộc).";
    case "23502": return "Thiếu dữ liệu bắt buộc.";
    case "42501": return "Bạn không có quyền thực hiện thao tác này.";
    default: return error.message;
  }
}

const UNIQUE_VIOLATION = "23505";

/**
 * Insert a row whose business code is generated client-side. Retries with a fresh code when the
 * DB reports a unique violation, so a (rare) collision never surfaces as a user-facing error.
 */
export async function insertWithGeneratedCode<R>(
  makeCode: () => string,
  insert: (code: string) => PromiseLike<{ data: R | null; error: PgError }>,
  maxTries = 5,
): Promise<{ data: R | null; error: PgError; code: string }> {
  let last: { data: R | null; error: PgError } = { data: null, error: null };
  let code = "";
  for (let i = 0; i < maxTries; i++) {
    code = makeCode();
    last = await insert(code);
    if (!last.error || last.error.code !== UNIQUE_VIOLATION) return { ...last, code };
  }
  return { ...last, code };
}

/**
 * FormData -> plain object: "" -> null, File values dropped, `multiKeys` collected with getAll.
 * (A multi-value key is only set when at least one non-empty value exists.)
 */
export function formDataToObject(formData: FormData, multiKeys: string[] = []): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  for (const [k, v] of formData.entries()) {
    if (typeof v !== "string") continue;
    if (multiKeys.includes(k)) continue;
    obj[k] = emptyToNull(v);
  }
  for (const k of multiKeys) {
    const vals = formData.getAll(k).filter((v): v is string => typeof v === "string" && v.trim() !== "");
    if (vals.length) obj[k] = vals;
  }
  return obj;
}

/** Narrow a PostgREST response with embedded relations to a hand-written row type (the untyped client infers arrays for to-one embeds). */
export function typed<T>(res: { data: unknown; error: PgError }): { data: T | null; error: PgError } {
  return res as unknown as { data: T | null; error: PgError };
}
