import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    environment: "node",
    // 数値検証は時間がかかるものがある
    testTimeout: 60_000,
  },
});
