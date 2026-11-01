import { defineConfig } from "vitest/config";

const common = {
  // Workspace tests shell out to real git; Windows fs + git can exceed 5s under load.
  testTimeout: 20000,
};

export default defineConfig({
  test: {
    projects: [
      { test: { ...common, name: "fake-store" } },
      // Same approve/dismiss/MCP tests, but findings live in pg-mem behind createDbFindingsStore (#51).
      {
        test: {
          ...common,
          name: "db-store",
          env: { FINDINGS_STORE: "db" },
          include: ["test/approve.test.ts", "test/dismiss.test.ts", "test/mcp.test.ts"],
        },
      },
    ],
  },
});
