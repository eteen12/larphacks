import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Workspace tests shell out to real git; Windows fs + git can exceed 5s under load.
    testTimeout: 20000,
  },
});
