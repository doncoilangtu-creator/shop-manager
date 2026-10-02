import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Unit/smoke tests for the Next.js web app. The Telegram bot has its own
// vitest config in bot/ (separate package.json / lockfile).
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    clearMocks: true,
  },
});
