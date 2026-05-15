import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function loadLocalEnv() {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  for (const file of [resolve(repoRoot, ".env"), resolve(repoRoot, "backend/.env")]) {
    if (existsSync(file)) process.loadEnvFile(file);
  }
}
