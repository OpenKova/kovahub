import { defineConfig, devices } from "@playwright/test";

const frontendPort = process.env.KOVAHUB_E2E_FRONTEND_PORT ?? "45173";
const backendPort = process.env.KOVAHUB_E2E_BACKEND_PORT ?? "48787";
const backendUrl = `http://127.0.0.1:${backendPort}`;
const frontendUrl = `http://127.0.0.1:${frontendPort}`;

const backendEnv = {
  DATABASE_URL: "",
  KOVAHUB_API_HOST: "127.0.0.1",
  KOVAHUB_API_PORT: backendPort,
  KOVAHUB_ARCHIVE_STORAGE: "local",
  KOVAHUB_ARCHIVE_DIR: ".kovahub/e2e-archives",
  KOVAHUB_E2E_AUTH: "1",
  KOVAHUB_JWT_SECRET: "kovahub-e2e-secret",
  KOVAHUB_REVIEWER_HANDLES: "tester",
  KOVAHUB_REGISTRY: backendUrl,
  KOVAHUB_REGISTRY_URL: backendUrl,
  KOVAHUB_SITE: frontendUrl,
  KOVAHUB_SITE_URL: frontendUrl,
  LOG_LEVEL: "warn",
  NODE_ENV: "test",
};

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  reporter: [["list"]],
  use: {
    baseURL: frontendUrl,
    trace: "on-first-retry",
  },
  webServer: [
    {
      command: "pnpm --filter @kovahub/backend exec tsx src/server.ts",
      url: `${backendUrl}/readyz`,
      env: backendEnv,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: `pnpm --filter @kovahub/frontend exec vite --host 127.0.0.1 --port ${frontendPort} --strictPort`,
      url: frontendUrl,
      env: {
        ...backendEnv,
        VITE_KOVAHUB_API_URL: backendUrl,
      },
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
