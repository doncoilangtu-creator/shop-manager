import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

// Every internal link written in app/** must resolve to an existing page/route (found 404s in the audit:
// /suppliers/[id], /maintenance/[id] ...). Dynamic `${...}` segments match any [param] folder.
const APP = join(process.cwd(), "app");

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}

const files = walk(APP);
// page routes: strip route groups (xxx), file name page.tsx|route.ts
const routes = files
  .filter((f) => /[\\/](page\.tsx|route\.ts)$/.test(f))
  .map((f) => "/" + relative(APP, join(f, "..")).split(sep).filter((s) => s && !/^\(.*\)$/.test(s)).join("/"))
  .map((r) => (r === "/" ? "/" : r.replace(/\/$/, "")));

function matches(href: string): boolean {
  const path = href.split("?")[0].split("#")[0].replace(/\/$/, "") || "/";
  const segs = path.split("/").filter(Boolean);
  return routes.some((r) => {
    const rs = r.split("/").filter(Boolean);
    if (rs.length !== segs.length) return false;
    return rs.every((s, i) => /^\[.+\]$/.test(s) || s === segs[i] || (segs[i] === "$" && /^\[.+\]$/.test(s)));
  });
}

describe("internal links resolve", () => {
  const src = files.filter((f) => /\.(tsx|ts)$/.test(f));
  const found: Array<{ file: string; href: string }> = [];
  for (const f of src) {
    const text = readFileSync(f, "utf8");
    for (const m of text.matchAll(/href=(?:"(\/[^"]*)"|\{`(\/[^`]*)`\})/g)) {
      const raw = (m[1] ?? m[2]).replace(/\$\{[^}]*\}/g, "$");
      found.push({ file: relative(process.cwd(), f), href: raw });
    }
  }
  it("found a plausible number of links", () => expect(found.length).toBeGreaterThan(20));
  // Pages that do not exist YET and are scheduled for a later cluster (none left after C7). Remove entries as
  // clusters land; the second test fails when an entry has become valid, so this list can only shrink.
  const KNOWN_MISSING = new Set<string>([]);
  const broken = [...new Set(found.filter((l) => !matches(l.href)).map((l) => l.href))];
  it("every href has a page (except the known, scheduled ones)", () => {
    const unexpected = found.filter((l) => !matches(l.href) && !KNOWN_MISSING.has(l.href));
    expect(unexpected, JSON.stringify(unexpected, null, 1)).toEqual([]);
  });
  it("the known-missing list contains only links that are still broken", () => {
    const stale = [...KNOWN_MISSING].filter((h) => !broken.includes(h));
    expect(stale).toEqual([]);
  });
});
