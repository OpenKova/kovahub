#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

type Config = {
  registry: string;
  token?: string;
};

const defaultRegistry = process.env.KOVAHUB_REGISTRY ?? process.env.KOVA_KOVAHUB_URL ?? "http://localhost:8787";
const configPath = path.join(homedir(), ".kovahub", "config.json");

function usage() {
  console.log(`KovaHub CLI

Usage:
  kovahub login [--registry URL]
  kovahub whoami [--registry URL]
  kovahub publish <metadata.json> [--archive archive.zip] [--registry URL]
`);
}

function readFlag(args: string[], name: string) {
  const index = args.indexOf(name);
  if (index === -1) return null;
  return args[index + 1] ?? null;
}

function withoutFlags(args: string[]) {
  const result: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index]?.startsWith("--")) {
      index += 1;
      continue;
    }
    result.push(args[index] as string);
  }
  return result;
}

async function readConfig(): Promise<Config> {
  try {
    return JSON.parse(await readFile(configPath, "utf8")) as Config;
  } catch {
    return { registry: defaultRegistry };
  }
}

async function writeConfig(config: Config) {
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
}

async function request<T>(registry: string, pathName: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("content-type") && !(init.body instanceof FormData)) {
    headers.set("content-type", "application/json");
  }
  const response = await fetch(`${registry.replace(/\/+$/, "")}${pathName}`, { ...init, headers });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const message = body && typeof body === "object" && "error" in body ? String(body.error) : `HTTP ${response.status}`;
    const error = new Error(message) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  return body as T;
}

async function login(args: string[]) {
  const registry = readFlag(args, "--registry") ?? (await readConfig()).registry ?? defaultRegistry;
  const start = await request<{
    deviceCode: string;
    userCode: string;
    verificationUriComplete: string;
    expiresIn: number;
    interval: number;
  }>(registry, "/api/v1/auth/device/start", {
    method: "POST",
    body: JSON.stringify({ clientName: "KovaHub CLI" }),
  });

  console.log(`Open: ${start.verificationUriComplete}`);
  console.log(`Code: ${start.userCode}`);

  const deadline = Date.now() + start.expiresIn * 1000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, start.interval * 1000));
    try {
      const token = await request<{ accessToken: string }>(registry, "/api/v1/auth/device/token", {
        method: "POST",
        body: JSON.stringify({ deviceCode: start.deviceCode }),
      });
      await writeConfig({ registry, token: token.accessToken });
      console.log("Logged in.");
      return;
    } catch (error) {
      if ((error as Error & { status?: number }).status === 428) continue;
      throw error;
    }
  }
  throw new Error("Device login expired.");
}

async function whoami(args: string[]) {
  const config = await readConfig();
  const registry = readFlag(args, "--registry") ?? config.registry ?? defaultRegistry;
  if (!config.token) throw new Error("Run kovahub login first.");
  const result = await request<{ user: { handle: string; email: string } }>(registry, "/api/v1/whoami", {
    headers: { authorization: `Bearer ${config.token}` },
  });
  console.log(`@${result.user.handle} <${result.user.email}>`);
}

async function publish(args: string[]) {
  const config = await readConfig();
  const registry = readFlag(args, "--registry") ?? config.registry ?? defaultRegistry;
  if (!config.token) throw new Error("Run kovahub login first.");
  const positional = withoutFlags(args);
  const metadataPath = positional[0];
  if (!metadataPath) throw new Error("Missing metadata JSON path.");
  const metadata = JSON.parse(await readFile(metadataPath, "utf8")) as Record<string, unknown>;
  const archivePath = readFlag(args, "--archive");

  if (archivePath) {
    const archive = await readFile(archivePath);
    metadata.archiveBase64 = archive.toString("base64");
  }

  const result = await request<{ package: { name: string; latestVersion?: string | null } }>(
    registry,
    "/api/v1/packages",
    {
      method: "POST",
      headers: { authorization: `Bearer ${config.token}` },
      body: JSON.stringify(metadata),
    },
  );
  console.log(`Published ${result.package.name}@${result.package.latestVersion ?? "unknown"}`);
}

async function main() {
  const [, , command, ...args] = process.argv;
  if (!command || command === "help" || command === "--help") {
    usage();
    return;
  }
  if (command === "login") return login(args);
  if (command === "whoami") return whoami(args);
  if (command === "publish") return publish(args);
  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
