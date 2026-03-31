import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Run test files sequentially — required because all tests share
    // the same Atlas Local Docker instance and ecommerce_app database.
    // Parallel execution causes race conditions on real MongoDB.
    fileParallelism: false,

    // Default timeout per test (ms) — some branch operations are slow on Docker
    testTimeout: 30_000,

    // Setup timeout — Atlas Local connection + seeding can take time
    hookTimeout: 30_000,

    // Include all test files
    include: ["tests/**/*.test.ts"],

    // Exclude stress tests by default (run with --include)
    exclude: [
      "tests/core/stress.test.ts",
      "tests/core/stress-ai.test.ts",
      "node_modules/**",
    ],
  },
});
