import process from "node:process";

const registryBase = normalizeBase(
  process.argv[2] ??
    process.env.KOVAHUB_REGISTRY_URL ??
    process.env.KOVA_KOVAHUB_URL ??
    process.env.KOVAHUB_URL ??
    process.env.KOVAHUB_REGISTRY ??
    "http://127.0.0.1:8787",
);

function normalizeBase(value) {
  return value.replace(/\/+$/, "");
}

function assertContract(condition, message) {
  if (!condition) throw new Error(message);
}

async function fetchJson(path) {
  const response = await fetch(`${registryBase}${path}`, {
    headers: { accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`${path} failed with HTTP ${response.status}`);
  }
  return response.json();
}

async function fetchArchive(path) {
  const response = await fetch(`${registryBase}${path}`, {
    headers: { accept: "application/zip" },
  });
  if (!response.ok) {
    throw new Error(`${path} failed with HTTP ${response.status}`);
  }
  assertContract(response.headers.get("content-type")?.includes("application/zip"), `${path} did not return a ZIP archive.`);
  assertContract(/^[a-f0-9]{64}$/.test(response.headers.get("x-kovahub-sha256") ?? ""), `${path} is missing archive sha256.`);
}

function expectPage(value, label) {
  assertContract(value && Array.isArray(value.items), `${label} must return an items array.`);
  assertContract("nextCursor" in value, `${label} must expose nextCursor.`);
}

function expectPackageShape(item, label) {
  assertContract(typeof item.name === "string" && item.name.length > 0, `${label} package name is required.`);
  assertContract(["skill", "code-plugin", "bundle-plugin"].includes(item.family), `${label} family is invalid.`);
  assertContract("latestVersion" in item, `${label} must expose latestVersion.`);
  assertContract("compatibility" in item, `${label} must expose compatibility metadata.`);
}

const wellKnown = await fetchJson("/.well-known/kovahub.json");
assertContract(wellKnown.name === "KovaHub", "well-known discovery must identify KovaHub.");
for (const route of ["packages", "plugins", "skills", "search", "whoami"]) {
  assertContract(typeof wellKnown.routes?.[route] === "string", `well-known discovery missing ${route} route.`);
}
assertContract(wellKnown.env?.kovaUrl === "KOVA_KOVAHUB_URL", "well-known discovery missing KOVA_KOVAHUB_URL alias.");
assertContract(wellKnown.env?.url === "KOVAHUB_URL", "well-known discovery missing KOVAHUB_URL alias.");

const meta = await fetchJson("/api/v1/meta");
for (const envName of ["KOVA_KOVAHUB_URL", "KOVAHUB_URL", "KOVAHUB_REGISTRY", "KOVAHUB_SITE"]) {
  assertContract(meta.compatibility?.env?.includes(envName), `meta compatibility missing ${envName}.`);
}
for (const field of ["pluginApiRange", "minGatewayVersion"]) {
  assertContract(meta.compatibility?.packageCompatibilityFields?.includes(field), `meta compatibility missing ${field}.`);
}

const packages = await fetchJson("/api/v1/packages?limit=5");
const plugins = await fetchJson("/api/v1/plugins?limit=5");
const skills = await fetchJson("/api/v1/skills?limit=5");
const search = await fetchJson("/api/v1/search?q=release&limit=5");

expectPage(packages, "packages");
expectPage(plugins, "plugins");
expectPage(skills, "skills");
assertContract(Array.isArray(search.results), "skill search must return a results array.");

for (const [label, page] of [
  ["packages", packages],
  ["plugins", plugins],
]) {
  for (const item of page.items) expectPackageShape(item, label);
}

if (packages.items.length > 0) {
  const item = packages.items[0];
  const detail = await fetchJson(`/api/v1/packages/${encodeURIComponent(item.name)}`);
  assertContract(detail.package?.name === item.name, "package detail must round-trip the package name.");
  assertContract("versions" in detail, "package detail must include versions.");
  assertContract("latestVersion" in detail, "package detail must include latestVersion.");

  if (detail.package.family !== "skill") {
    assertContract(
      "pluginApiRange" in (detail.package.compatibility ?? {}),
      "plugin package detail must expose pluginApiRange.",
    );
    assertContract(
      "minGatewayVersion" in (detail.package.compatibility ?? {}),
      "plugin package detail must expose minGatewayVersion.",
    );
  }

  if (detail.package.latestVersion) {
    await fetchArchive(`/api/v1/packages/${encodeURIComponent(item.name)}/download?tag=latest`);
  }
}

if (skills.items.length > 0) {
  const item = skills.items[0];
  const detail = await fetchJson(`/api/v1/skills/${encodeURIComponent(item.slug ?? item.name)}`);
  assertContract(detail.skill?.slug === (item.slug ?? item.name), "skill detail must round-trip the skill slug.");
  if (detail.latestVersion?.version) {
    await fetchArchive(
      `/api/v1/download?slug=${encodeURIComponent(item.slug ?? item.name)}&version=${encodeURIComponent(
        detail.latestVersion.version,
      )}`,
    );
  }
}

console.log(`Kova registry contract check passed for ${registryBase}`);

