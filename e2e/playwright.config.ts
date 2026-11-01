import { defineConfig } from "@playwright/test";

// Needs DATABASE_URL (a throwaway Postgres database: the backend wipes its findings table) and a
// built app (`npm run build:app`, which inlines EXPO_PUBLIC_* at build time).
const API = "http://127.0.0.1:3100";
const APP = "http://127.0.0.1:8081";

export default defineConfig({
  testDir: "./tests",
  workers: 1, // one shared database and one fake GitHub
  retries: 0,
  timeout: 30_000,
  reporter: [["list"], ["html", { open: "never" }]],
  outputDir: "test-results",
  use: {
    baseURL: APP,
    viewport: { width: 375, height: 812 },
    hasTouch: false,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: [
    {
      command: "npx tsx test/e2e-server.ts",
      cwd: "../backend",
      url: `${API}/health`,
      timeout: 60_000,
      reuseExistingServer: false,
      env: {
        PORT: "3100",
        FINDINGS_API_KEY: "e2e-key",
        FRONTEND_ORIGIN: APP,
        DATABASE_URL: process.env.DATABASE_URL ?? "",
      },
    },
    {
      command: "npx expo serve --port 8081",
      cwd: "..",
      url: APP,
      timeout: 60_000,
      reuseExistingServer: false,
    },
  ],
});
