/**
 * Free-text search terms go into PostgREST `.or("name.ilike.%term%,sku.ilike.%term%")` strings.
 * Characters with meaning in that grammar (`,` `(` `)` `"` `\` `*`) or in LIKE (`%` `_`) must not
 * come from user input, otherwise a search for `a,id.eq.1` changes the query. We drop them (a
 * search box does not need them) and cap the length.
 */
export function sanitizeSearchTerm(input: string | null | undefined, maxLen = 64): string {
  return (input ?? "")
    .normalize("NFC")
    .replace(/[%_,()"'\\*:;]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLen);
}

/** `col.ilike.%term%` clauses joined for `.or()`. Returns null when the term is empty after sanitising. */
export function ilikeOr(columns: string[], term: string | null | undefined): string | null {
  const t = sanitizeSearchTerm(term);
  if (!t) return null;
  return columns.map((c) => `${c}.ilike.%${t}%`).join(",");
}
