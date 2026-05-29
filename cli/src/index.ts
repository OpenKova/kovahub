#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

type Config = {
  registry: string;
  token?: string;
  installDir?: string;
  installed?: Record<string, InstalledPackage>;
};

type InstalledPackage = {
  name: string;
  version: string;
  archivePath: string;
  installedAt: number;
  updatedAt: number;
  pinned?: boolean;
};

const defaultRegistry = process.env.KOVAHUB_REGISTRY ?? process.env.KOVA_KOVAHUB_URL ?? "http://localhost:8787";
const configPath = path.join(homedir(), ".kovahub", "config.json");

function usage() {
  console.log(`KovaHub CLI

Usage:
  kovahub login [--registry URL]
  kovahub whoami [--registry URL]
  kovahub install <package> [--version VERSION] [--dir DIR] [--registry URL]
  kovahub update [package] [--dir DIR] [--registry URL]
  kovahub sync [--dir DIR] [--registry URL]
  kovahub list
  kovahub pin <package> [version]
  kovahub unpin <package>
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

function installedPackages(config: Config) {
  return config.installed ?? {};
}

function installDir(config: Config, override: string | null) {
  return override ?? config.installDir ?? path.join(homedir(), ".kovahub", "packages");
}

function packagePathSegment(name: string) {
  return name.replace(/^@/, "").replace(/[^A-Za-z0-9._-]+/g, "__");
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

async function downloadArchive(registry: string, name: string, version?: string | null) {
  const query = new URLSearchParams();
  if (version) query.set("version", version);
  const suffix = query.toString() ? `?${query.toString()}` : "";
  const response = await fetch(`${registry.replace(/\/+$/, "")}/api/v1/packages/${encodeURIComponent(name)}/download${suffix}`);
  if (!response.ok) throw new Error(`Archive download failed with HTTP ${response.status}.`);
  return Buffer.from(await response.arrayBuffer());
}

async function fetchPackage(registry: string, name: string) {
  return request<{
    package: {
      name: string;
      displayName: string;
      latestVersion?: string | null;
      versions?: Array<{ version: string; yankedAt?: number | null }>;
    } | null;
  }>(registry, `/api/v1/packages/${encodeURIComponent(name)}`);
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

async function installPackage(args: string[]) {
  const config = await readConfig();
  const registry = readFlag(args, "--registry") ?? config.registry ?? defaultRegistry;
  const positional = withoutFlags(args);
  const name = positional[0];
  if (!name) throw new Error("Missing package name.");
  const detail = await fetchPackage(registry, name);
  const pkg = detail.package;
  if (!pkg) throw new Error("Package not found.");
  const requestedVersion = readFlag(args, "--version");
  const version = requestedVersion ?? pkg.latestVersion;
  if (!version) throw new Error("Package has no installable version.");
  const archive = await downloadArchive(registry, pkg.name, version);
  await request(registry, `/api/v1/packages/${encodeURIComponent(pkg.name)}/install`, { method: "POST" });

  const root = installDir(config, readFlag(args, "--dir"));
  const packageDir = path.join(root, packagePathSegment(pkg.name));
  await mkdir(packageDir, { recursive: true });
  const archivePath = path.join(packageDir, `${version}.zip`);
  await writeFile(archivePath, archive);
  const installed = installedPackages(config);
  const now = Date.now();
  const existing = installed[pkg.name];
  installed[pkg.name] = {
    name: pkg.name,
    version,
    archivePath,
    installedAt: existing?.installedAt ?? now,
    updatedAt: now,
    pinned: existing?.pinned && existing.version === version ? true : existing?.pinned,
  };
  await writeConfig({ ...config, registry, installDir: root, installed });
  console.log(`Installed ${pkg.name}@${version}`);
  console.log(archivePath);
}

async function updateInstalled(args: string[]) {
  const config = await readConfig();
  const registry = readFlag(args, "--registry") ?? config.registry ?? defaultRegistry;
  const positional = withoutFlags(args);
  const requestedName = positional[0];
  const installed = installedPackages(config);
  const targets = requestedName
    ? Object.values(installed).filter((entry) => entry.name === requestedName)
    : Object.values(installed).filter((entry) => !entry.pinned);
  if (targets.length === 0) {
    console.log(requestedName ? "Package is not installed." : "No unpinned packages to update.");
    return;
  }
  for (const entry of targets) {
    const detail = await fetchPackage(registry, entry.name);
    const latest = detail.package?.latestVersion;
    if (!latest) {
      console.log(`${entry.name}: no latest version`);
      continue;
    }
    if (entry.pinned) {
      console.log(`${entry.name}: pinned at ${entry.version}`);
      continue;
    }
    if (latest === entry.version) {
      console.log(`${entry.name}: already at ${entry.version}`);
      continue;
    }
    await installPackage([entry.name, "--version", latest, "--registry", registry, "--dir", installDir(config, readFlag(args, "--dir"))]);
  }
}

async function listInstalled() {
  const config = await readConfig();
  const entries = Object.values(installedPackages(config)).sort((left, right) => left.name.localeCompare(right.name));
  if (entries.length === 0) {
    console.log("No packages installed.");
    return;
  }
  for (const entry of entries) {
    const pin = entry.pinned ? " pinned" : "";
    console.log(`${entry.name}@${entry.version}${pin}`);
    console.log(`  ${entry.archivePath}`);
  }
}

async function pinPackage(args: string[]) {
  const config = await readConfig();
  const positional = withoutFlags(args);
  const name = positional[0];
  const version = positional[1];
  if (!name) throw new Error("Missing package name.");
  const installed = installedPackages(config);
  const entry = installed[name];
  if (!entry) throw new Error("Package is not installed.");
  entry.pinned = true;
  if (version) entry.version = version;
  entry.updatedAt = Date.now();
  await writeConfig({ ...config, installed });
  console.log(`Pinned ${entry.name}@${entry.version}`);
}

async function unpinPackage(args: string[]) {
  const config = await readConfig();
  const positional = withoutFlags(args);
  const name = positional[0];
  if (!name) throw new Error("Missing package name.");
  const installed = installedPackages(config);
  const entry = installed[name];
  if (!entry) throw new Error("Package is not installed.");
  entry.pinned = false;
  entry.updatedAt = Date.now();
  await writeConfig({ ...config, installed });
  console.log(`Unpinned ${entry.name}`);
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
  if (command === "install") return installPackage(args);
  if (command === "update") return updateInstalled(args);
  if (command === "sync") return updateInstalled(args);
  if (command === "list") return listInstalled();
  if (command === "pin") return pinPackage(args);
  if (command === "unpin") return unpinPackage(args);
  if (command === "publish") return publish(args);
  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
