import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    globals: true,
    // The RLS suites run over the network against the shared hosted project (CLAUDE.md §9).
    // Running files in parallel bursts Supabase's auth rate limit with concurrent sign-ins,
    // and every assertion is a round trip, so the default 5s timeout is far too tight.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
  resolve: { alias: { "@": path.resolve(__dirname, ".") } },
});
