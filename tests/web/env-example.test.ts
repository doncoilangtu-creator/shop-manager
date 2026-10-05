import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const script = resolve(__dirname, "../../scripts/check-env-example.mjs");
const run = (...args: string[]) => spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });

describe(".env.example stays in sync with the code", () => {
  it("web: every env var read by the code is documented and nothing documented is dead", () => {
    const r = run(resolve(__dirname, "../.."), ".env.example");
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
  });
  it("bot: bot/.env.example matches bot/src", () => {
    const r = run(resolve(__dirname, "../../bot"), ".env.example", "src");
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
  });
  it("the checker itself detects drift in both directions", () => {
    const d = mkdtempSync(join(tmpdir(), "envchk-"));
    mkdirSync(join(d, "src"));
    writeFileSync(join(d, "src/a.ts"), 'const a = process.env.USED_AND_DOC; const b = process.env["USED_NOT_DOC"]; const c = process.env.NODE_ENV;');
    writeFileSync(join(d, ".env.example"), "USED_AND_DOC=1\n# DOC_NOT_USED=2\n");
    const r = run(d, ".env.example", "src");
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("USED_NOT_DOC");
    expect(r.stderr).toContain("DOC_NOT_USED");
    expect(r.stderr).not.toContain("NODE_ENV");
    expect(() => execFileSync(process.execPath, [script, d, ".env.example", "src"], { stdio: "pipe" })).toThrow();
  });
});
