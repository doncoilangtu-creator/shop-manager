import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Unit/smoke tests for the Next.js web app. The Telegram bot has its own
// vitest config in bot/ (separate package.json / lockfile).
export default defineConfig({
  // tsconfig dùng jsx: "preserve" cho Next; test cần biên dịch JSX (mẫu PDF react-pdf)
  oxc: { jsx: { runtime: "automatic" } },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
      // `server-only` throws outside the React server graph; stub it for unit tests.
      "server-only": fileURLToPath(new URL("./tests/web/stubs/server-only.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    clearMocks: true,
  },
});
