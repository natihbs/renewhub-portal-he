import { defineConfig } from "vitest/config";
import path from "node:path";

// Minimal, standalone Vitest config — intentionally does NOT reuse vite.config.ts,
// which pulls in @lovable.dev/vite-tanstack-config (SSR/TanStack Start/Nitro
// plugins that assume a browser+server build, not a plain Node test run).
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/__tests__/**/*.test.ts"],
  },
});
