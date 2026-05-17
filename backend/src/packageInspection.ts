import { createHash } from "node:crypto";
import { strFromU8, unzipSync } from "fflate";
import {
  packageFamilies,
  publishPackageSchema,
  type PackageCapabilitySummary,
  type PackageCompatibility,
  type PackageDocumentation,
  type PackageFamily,
  type PackageFile,
  type PreparedPublishPackageInput,
  type PublishPackageInput,
} from "./contracts.js";

const maxArchiveEntries = Number.parseInt(process.env.KOVAHUB_MAX_ARCHIVE_ENTRIES ?? "1000", 10);
const maxExtractedBytes = Number.parseInt(process.env.KOVAHUB_MAX_EXTRACTED_BYTES ?? `${50 * 1024 * 1024}`, 10);
const maxDocumentationBytes = Number.parseInt(process.env.KOVAHUB_MAX_DOCUMENTATION_BYTES ?? `${256 * 1024}`, 10);
const safeRelativePath = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*\/\/)[A-Za-z0-9._@+/-]+$/;

type JsonRecord = Record<string, unknown>;

export type ArchiveInspectionResult = {
  files: PackageFile[];
  packageJson: JsonRecord | null;
  skillManifest: {
    name?: string;
    description?: string;
  } | null;
  documentation: PackageDocumentation | null;
};

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readRecord(value: unknown): JsonRecord | undefined {
  return isRecord(value) ? value : undefined;
}

function sha256Hex(bytes: Uint8Array | Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}

function parseJson(bytes: Uint8Array, path: string) {
  try {
    const parsed = JSON.parse(strFromU8(bytes));
    if (!isRecord(parsed)) throw new Error(`${path} must contain a JSON object.`);
    return parsed;
  } catch (error) {
    if (error instanceof Error && error.message.endsWith("must contain a JSON object.")) throw error;
    throw new Error(`${path} is not valid JSON.`);
  }
}

function parseSkillFrontmatter(bytes: Uint8Array) {
  const text = strFromU8(bytes);
  if (!text.startsWith("---\n")) return null;
  const end = text.indexOf("\n---", 4);
  if (end < 0) return null;
  const result: { name?: string; description?: string } = {};
  for (const line of text.slice(4, end).split("\n")) {
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim().replace(/^["']|["']$/g, "");
    if (key === "name" && value) result.name = value;
    if (key === "description" && value) result.description = value;
  }
  return Object.keys(result).length > 0 ? result : null;
}

function singleRootPrefix(paths: string[]) {
  const roots = new Set(paths.map((path) => path.split("/")[0]).filter(Boolean));
  return roots.size === 1 ? [...roots][0] ?? null : null;
}

function findEntry(entries: Map<string, Uint8Array>, paths: string[]) {
  for (const path of paths) {
    const entry = entries.get(path);
    if (entry) return entry;
  }
  return undefined;
}

function findEntryWithPath(entries: Map<string, Uint8Array>, paths: string[]) {
  for (const path of paths) {
    const entry = entries.get(path);
    if (entry) return { path, bytes: entry };
  }
  return null;
}

function readDocumentationEntry(entry: { path: string; bytes: Uint8Array } | null) {
  if (!entry) return undefined;
  if (entry.bytes.byteLength > maxDocumentationBytes) {
    throw new Error(`${entry.path} is larger than ${maxDocumentationBytes} bytes.`);
  }
  return strFromU8(entry.bytes);
}

function buildArchiveDocumentation(
  entries: Map<string, Uint8Array>,
  root: string | null,
): PackageDocumentation | null {
  const readme = findEntryWithPath(entries, [
    "README.md",
    "README.markdown",
    "readme.md",
    root ? `${root}/README.md` : "",
    root ? `${root}/README.markdown` : "",
    root ? `${root}/readme.md` : "",
  ].filter(Boolean));
  const skill = findEntryWithPath(entries, ["SKILL.md", root ? `${root}/SKILL.md` : ""].filter(Boolean));
  const documentation: PackageDocumentation = {
    readmePath: readme?.path,
    readmeMarkdown: readDocumentationEntry(readme),
    skillPath: skill?.path,
    skillMarkdown: readDocumentationEntry(skill),
  };
  return Object.values(documentation).some(Boolean) ? documentation : null;
}

function normalizeKovaCompatibility(packageJson: JsonRecord): PackageCompatibility | null {
  const kova = readRecord(packageJson.kova);
  const compat = readRecord(kova?.compat);
  const build = readRecord(kova?.build);
  const install = readRecord(kova?.install);
  const pluginApiRange = readString(compat?.pluginApi);
  const minGatewayVersion = readString(compat?.minGatewayVersion) ?? readString(install?.minHostVersion);
  const builtWithKovaVersion = readString(build?.kovaVersion) ?? readString(packageJson.version);
  const pluginSdkVersion = readString(build?.pluginSdkVersion);
  const compatibility: PackageCompatibility = {
    pluginApiRange,
    minGatewayVersion,
    builtWithKovaVersion,
    pluginSdkVersion,
  };
  const entries = Object.entries(compatibility).filter(([, value]) => Boolean(value));
  return entries.length > 0 ? Object.fromEntries(entries) : null;
}

function inferFamily(packageJson: JsonRecord | null, skillManifest: ArchiveInspectionResult["skillManifest"]): PackageFamily {
  const kova = readRecord(packageJson?.kova);
  const declaredFamily = readString(readRecord(kova?.package)?.family);
  if (declaredFamily && packageFamilies.includes(declaredFamily as PackageFamily)) {
    return declaredFamily as PackageFamily;
  }
  if (Array.isArray(kova?.bundlePlugins) || readRecord(kova?.bundle)?.plugins) return "bundle-plugin";
  if (Array.isArray(kova?.extensions) || readRecord(kova?.channel) || readRecord(kova?.provider)) {
    return "code-plugin";
  }
  return skillManifest ? "skill" : "code-plugin";
}

function validateKovaPluginPackageJson(packageJson: JsonRecord | null, family: PackageFamily) {
  if (family === "skill") return;
  if (!packageJson) throw new Error("package.json is required for Kova plugin archive publishing.");
  const kova = readRecord(packageJson.kova);
  const compat = readRecord(kova?.compat);
  const build = readRecord(kova?.build);
  const install = readRecord(kova?.install);
  const missing: string[] = [];
  if (!readString(compat?.pluginApi)) missing.push("kova.compat.pluginApi");
  if (!readString(compat?.minGatewayVersion) && !readString(install?.minHostVersion)) {
    missing.push("kova.compat.minGatewayVersion");
  }
  if (!readString(build?.kovaVersion)) missing.push("kova.build.kovaVersion");
  if (missing.length > 0) {
    throw new Error(`Kova plugin archive is missing required package.json field(s): ${missing.join(", ")}.`);
  }
}

function normalizeMetadata(value: unknown): Partial<PublishPackageInput> {
  return isRecord(value) ? (value as Partial<PublishPackageInput>) : {};
}

export function inspectZipArchive(archive: Buffer): ArchiveInspectionResult {
  let unzipped: Record<string, Uint8Array>;
  try {
    unzipped = unzipSync(new Uint8Array(archive));
  } catch {
    throw new Error("Only ZIP archives are supported for package upload.");
  }

  const entries = new Map<string, Uint8Array>();
  let totalBytes = 0;
  for (const [path, bytes] of Object.entries(unzipped)) {
    if (path.endsWith("/")) continue;
    if (!safeRelativePath.test(path)) throw new Error(`Archive contains an unsafe path: ${path}`);
    entries.set(path, bytes);
    totalBytes += bytes.byteLength;
    if (entries.size > maxArchiveEntries) throw new Error(`Archive has more than ${maxArchiveEntries} files.`);
    if (totalBytes > maxExtractedBytes) {
      throw new Error(`Archive extracts to more than ${maxExtractedBytes} bytes.`);
    }
  }

  if (entries.size === 0) throw new Error("Archive does not contain files.");

  const paths = [...entries.keys()];
  const root = singleRootPrefix(paths);
  const packageEntry = findEntry(entries, [
    "package.json",
    root ? `${root}/package.json` : "",
  ].filter(Boolean));
  const skillEntry = findEntry(entries, ["SKILL.md", root ? `${root}/SKILL.md` : ""].filter(Boolean));

  return {
    files: [...entries.entries()].map(([path, bytes]) => ({
      path,
      size: bytes.byteLength,
      sha256: sha256Hex(bytes),
      contentType: path.endsWith(".json")
        ? "application/json"
        : path.endsWith(".md")
          ? "text/markdown"
          : undefined,
    })),
    packageJson: packageEntry ? parseJson(packageEntry, "package.json") : null,
    skillManifest: skillEntry ? parseSkillFrontmatter(skillEntry) : null,
    documentation: buildArchiveDocumentation(entries, root),
  };
}

export function preparePublishInputFromArchive(params: {
  archive: Buffer;
  metadata?: unknown;
}): PreparedPublishPackageInput {
  const inspection = inspectZipArchive(params.archive);
  const metadata = normalizeMetadata(params.metadata);
  const packageJson = inspection.packageJson;
  const family = metadata.family ?? inferFamily(packageJson, inspection.skillManifest);
  const compatibility = packageJson ? normalizeKovaCompatibility(packageJson) : null;
  validateKovaPluginPackageJson(packageJson, family);

  const packageName = readString(packageJson?.name) ?? inspection.skillManifest?.name;
  const packageVersion = readString(packageJson?.version);
  const summary = readString(packageJson?.description) ?? inspection.skillManifest?.description;
  const capabilities: PackageCapabilitySummary | undefined =
    family === "skill"
      ? undefined
      : {
          executesCode: family === "code-plugin",
          runtimeId: packageName,
          capabilityTags: [
            family === "code-plugin" ? "plugin:code" : "plugin:bundle",
            "source:archive",
          ],
        };

  const metadataCompatibility = isRecord(metadata.compatibility) ? metadata.compatibility : {};
  const metadataCapabilities = isRecord(metadata.capabilities) ? metadata.capabilities : {};
  const mergedCapabilities = {
    ...(capabilities ?? {}),
    ...metadataCapabilities,
  };
  const candidate = {
    name: packageName,
    displayName: packageName,
    family,
    version: packageVersion,
    summary,
    changelog: "",
    channel: "community",
    tags: ["archive"],
    files: [],
    ...metadata,
    compatibility: {
      ...(compatibility ?? {}),
      ...metadataCompatibility,
    },
    capabilities: Object.keys(mergedCapabilities).length > 0 ? mergedCapabilities : undefined,
  };

  const parsed = publishPackageSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Archive metadata is not publishable.");
  }

  return {
    ...parsed.data,
    archiveBuffer: params.archive,
    archiveFiles: inspection.files,
    documentation: inspection.documentation,
  };
}
