#!/usr/bin/env node
// Verifies that every environment variable the code reads is documented in .env.example (and vice versa).
//   node scripts/check-env-example.mjs [dir=.] [envFile=.env.example] [srcDirs=app,lib,components,middleware.ts,scripts]
// Exit 1 with a list of differences. Used by tests/web/env-example.test.ts and bot/tests/env-example.test.ts.
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

const PLATFORM = new Set(["NODE_ENV", "VERCEL", "VERCEL_URL", "VERCEL_ENV", "NEXT_RUNTIME", "NEXT_PHASE", "CI", "NEXT_TELEMETRY_DISABLED"]);

export function collectEnvUsage(root, srcs) {
  const used = new Map();
  const walk = (p) => {
    if (!existsSync(p)) return;
    const st = statSync(p);
    if (st.isDirectory()) { for (const f of readdirSync(p)) if (!["node_modules", ".next", "dist"].includes(f)) walk(join(p, f)); return; }
    if (!/\.(ts|tsx|mjs|js|mts)$/.test(p) || /\.test\./.test(p)) return;
    const text = readFileSync(p, "utf8");
    for (const m of text.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) used.set(m[1], p);
    for (const m of text.matchAll(/process\.env\[\s*["'`]([A-Z][A-Z0-9_]*)["'`]\s*\]/g)) used.set(m[1], p);
    // lib/shop.ts builds SHOP_<KEY> names dynamically: declare them explicitly
    if (/env\[`SHOP_\$\{k\}`\]/.test(text)) for (const k of ["NAME", "TAX_CODE", "ADDRESS", "PHONE", "EMAIL"]) used.set(`SHOP_${k}`, p);
  };
  for (const s of srcs) walk(join(root, s));
  return used;
}

export function documentedVars(envFile) {
  const out = new Set();
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = /^\s*#?\s*([A-Z][A-Z0-9_]*)=/.exec(line);
    if (m) out.add(m[1]);
  }
  return out;
}

export function diffEnv(root, envFile, srcs, ignoreUnused = []) {
  const used = collectEnvUsage(root, srcs);
  const doc = documentedVars(join(root, envFile));
  const missing = [...used.keys()].filter((k) => !doc.has(k) && !PLATFORM.has(k)).sort();
  const unused = [...doc].filter((k) => !used.has(k) && !ignoreUnused.includes(k)).sort();
  return { missing, unused };
}

import { fileURLToPath } from "node:url";
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = process.argv[2] ?? ".";
  const envFile = process.argv[3] ?? ".env.example";
  const srcs = (process.argv[4] ?? "app,lib,components,middleware.ts,scripts").split(",");
  const { missing, unused } = diffEnv(root, envFile, srcs);
  if (missing.length) console.error("Used in code but missing from " + envFile + ": " + missing.join(", "));
  if (unused.length) console.error("Documented in " + envFile + " but never read: " + unused.join(", "));
  process.exit(missing.length || unused.length ? 1 : 0);
}
