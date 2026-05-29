import { spawn } from "node:child_process";
import process from "node:process";

const frontendPort = process.env.KOVAHUB_E2E_FRONTEND_PORT ?? "45173";
const backendPort = process.env.KOVAHUB_E2E_BACKEND_PORT ?? "48787";

const env = {
  ...process.env,
  DATABASE_URL: "",
  KOVAHUB_API_HOST: "127.0.0.1",
  KOVAHUB_API_PORT: backendPort,
  KOVAHUB_ARCHIVE_STORAGE: "local",
  KOVAHUB_ARCHIVE_DIR: ".kovahub/e2e-archives",
  KOVAHUB_E2E_AUTH: "1",
  KOVAHUB_JWT_SECRET: "kovahub-e2e-secret",
  KOVAHUB_REVIEWER_HANDLES: "tester",
  KOVAHUB_REGISTRY: `http://127.0.0.1:${backendPort}`,
  KOVAHUB_REGISTRY_URL: `http://127.0.0.1:${backendPort}`,
  KOVAHUB_SITE: `http://127.0.0.1:${frontendPort}`,
  KOVAHUB_SITE_URL: `http://127.0.0.1:${frontendPort}`,
  LOG_LEVEL: process.env.LOG_LEVEL ?? "warn",
  VITE_KOVAHUB_API_URL: `http://127.0.0.1:${backendPort}`,
};

const detached = process.platform !== "win32";

const children = [
  spawn("pnpm", ["--filter", "@kovahub/backend", "exec", "tsx", "src/server.ts"], {
    cwd: process.cwd(),
    env,
    detached,
    stdio: "inherit",
  }),
  spawn(
    "pnpm",
    [
      "--filter",
      "@kovahub/frontend",
      "exec",
      "vite",
      "--host",
      "127.0.0.1",
      "--port",
      frontendPort,
      "--strictPort",
    ],
    {
      cwd: process.cwd(),
      env,
      detached,
      stdio: "inherit",
    },
  ),
];

let shuttingDown = false;

function stopChildren(signal = "SIGTERM") {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (child.killed) continue;
    try {
      if (detached) process.kill(-child.pid, signal);
      else child.kill(signal);
    } catch {
      child.kill(signal);
    }
  }
}

for (const child of children) {
  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    stopChildren();
    if (signal) process.kill(process.pid, signal);
    else process.exit(code ?? 1);
  });
}

process.on("SIGINT", () => {
  stopChildren("SIGINT");
  setTimeout(() => process.exit(0), 1_000).unref();
});

process.on("SIGTERM", () => {
  stopChildren("SIGTERM");
  setTimeout(() => process.exit(0), 1_000).unref();
});
