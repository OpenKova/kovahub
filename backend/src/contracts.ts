import { z } from "zod";

export const packageFamilies = ["skill", "code-plugin", "bundle-plugin"] as const;
export const packageChannels = ["official", "community", "private"] as const;

export type PackageFamily = (typeof packageFamilies)[number];
export type PackageChannel = (typeof packageChannels)[number];

export type PackageCompatibility = {
  pluginApiRange?: string;
  builtWithKovaVersion?: string;
  pluginSdkVersion?: string;
  minGatewayVersion?: string;
};

export type PackageCapabilitySummary = {
  executesCode: boolean;
  runtimeId?: string;
  pluginKind?: string;
  channels?: string[];
  providers?: string[];
  hooks?: string[];
  bundledSkills?: string[];
  setupEntry?: boolean;
  configSchema?: boolean;
  configUiHints?: boolean;
  materializesDependencies?: boolean;
  toolNames?: string[];
  commandNames?: string[];
  serviceNames?: string[];
  capabilityTags?: string[];
  bundleFormat?: string;
  hostTargets?: string[];
};

export type PackageVerificationSummary = {
  tier: "structural" | "source-linked" | "provenance-verified" | "rebuild-verified";
  scope: "artifact-only" | "dependency-graph-aware";
  summary?: string;
  sourceRepo?: string;
  sourceCommit?: string;
  hasProvenance?: boolean;
  scanStatus?: "clean" | "suspicious" | "malicious" | "pending" | "not-run";
};

export type PackageFile = {
  path: string;
  size: number;
  sha256: string;
  contentType?: string;
};

export type PackageListItem = {
  name: string;
  displayName: string;
  family: PackageFamily;
  runtimeId?: string | null;
  channel: PackageChannel;
  isOfficial: boolean;
  summary?: string | null;
  ownerHandle?: string | null;
  createdAt: number;
  updatedAt: number;
  latestVersion?: string | null;
  capabilityTags?: string[];
  executesCode?: boolean;
  verificationTier?: string | null;
};

export type PackageVersionRecord = {
  version: string;
  createdAt: number;
  changelog: string;
  distTags: string[];
  files: PackageFile[];
  sha256hash: string;
  compatibility?: PackageCompatibility | null;
  capabilities?: PackageCapabilitySummary | null;
  verification?: PackageVerificationSummary | null;
  archive: Buffer;
};

export type PackageRecord = PackageListItem & {
  tags: Record<string, string>;
  compatibility?: PackageCompatibility | null;
  capabilities?: PackageCapabilitySummary | null;
  verification?: PackageVerificationSummary | null;
  versions: PackageVersionRecord[];
  stats: {
    downloads: number;
    installs: number;
    stars: number;
    versions: number;
  };
};

const semverLike = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const packageNameLike = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i;
const skillSlugLike = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i;
const safeRelativePath = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*\/\/)[A-Za-z0-9._@+/-]+$/;

export const fileInputSchema = z
  .object({
    path: z.string().min(1).max(512).regex(safeRelativePath),
    content: z.string().optional(),
    contentBase64: z.string().optional(),
    contentType: z.string().optional(),
  })
  .refine((value) => Boolean(value.content ?? value.contentBase64), {
    message: "Either content or contentBase64 is required",
  });

export const compatibilityInputSchema = z
  .object({
    pluginApi: z.string().trim().min(1).optional(),
    pluginApiRange: z.string().trim().min(1).optional(),
    builtWithKovaVersion: z.string().trim().min(1).optional(),
    pluginSdkVersion: z.string().trim().min(1).optional(),
    minGatewayVersion: z.string().trim().min(1).optional(),
  })
  .optional();

export const capabilityInputSchema = z
  .object({
    executesCode: z.boolean().default(false),
    runtimeId: z.string().trim().min(1).optional(),
    pluginKind: z.string().trim().min(1).optional(),
    channels: z.array(z.string()).optional(),
    providers: z.array(z.string()).optional(),
    hooks: z.array(z.string()).optional(),
    bundledSkills: z.array(z.string()).optional(),
    capabilityTags: z.array(z.string()).optional(),
    bundleFormat: z.string().trim().min(1).optional(),
    hostTargets: z.array(z.string()).optional(),
  })
  .optional();

export const publishPackageSchema = z
  .object({
    name: z.string().trim().min(1).max(214).regex(packageNameLike),
    displayName: z.string().trim().min(1).max(120).optional(),
    ownerHandle: z.string().trim().min(1).max(80).optional(),
    family: z.enum(packageFamilies),
    version: z.string().trim().regex(semverLike),
    summary: z.string().trim().max(500).optional(),
    changelog: z.string().default(""),
    channel: z.enum(packageChannels).default("community"),
    tags: z.array(z.string().trim().min(1).max(48)).default([]),
    compatibility: compatibilityInputSchema,
    capabilities: capabilityInputSchema,
    archiveBase64: z.string().optional(),
    files: z.array(fileInputSchema).default([]),
  })
  .superRefine((value, ctx) => {
    if (value.family === "skill" && !skillSlugLike.test(value.name)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["name"],
        message: "Skill packages require a Kova skill slug like release-notes-sherpa.",
      });
    }
  });

export type PublishPackageInput = z.infer<typeof publishPackageSchema>;

export type PreparedPublishPackageInput = PublishPackageInput & {
  archiveBuffer?: Buffer;
  archiveFiles?: PackageFile[];
};

export function normalizeCompatibility(
  input: PublishPackageInput["compatibility"],
): PackageCompatibility | null {
  if (!input) return null;
  const pluginApiRange = input.pluginApiRange ?? input.pluginApi;
  const compatibility: PackageCompatibility = {
    pluginApiRange,
    builtWithKovaVersion: input.builtWithKovaVersion,
    pluginSdkVersion: input.pluginSdkVersion,
    minGatewayVersion: input.minGatewayVersion,
  };
  const entries = Object.entries(compatibility).filter(([, value]) => Boolean(value));
  return entries.length > 0 ? Object.fromEntries(entries) : null;
}

export function toPackageListItem(record: PackageRecord): PackageListItem {
  return {
    name: record.name,
    displayName: record.displayName,
    family: record.family,
    runtimeId: record.runtimeId,
    channel: record.channel,
    isOfficial: record.isOfficial,
    summary: record.summary,
    ownerHandle: record.ownerHandle,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    latestVersion: record.latestVersion,
    capabilityTags: record.capabilityTags,
    executesCode: record.executesCode,
    verificationTier: record.verificationTier,
  };
}
