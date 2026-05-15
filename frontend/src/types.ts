export type PackageFamily = "skill" | "code-plugin" | "bundle-plugin";
export type PackageChannel = "official" | "community" | "private";

export type PackageCompatibility = {
  pluginApiRange?: string;
  builtWithKovaVersion?: string;
  pluginSdkVersion?: string;
  minGatewayVersion?: string;
};

export type PackageCapabilities = {
  executesCode: boolean;
  runtimeId?: string;
  pluginKind?: string;
  channels?: string[];
  providers?: string[];
  hooks?: string[];
  bundledSkills?: string[];
  capabilityTags?: string[];
  bundleFormat?: string;
  hostTargets?: string[];
};

export type PackageFile = {
  path: string;
  size: number;
  sha256: string;
  contentType?: string;
};

export type PackageVersionSummary = {
  version: string;
  createdAt: number;
  changelog: string;
  distTags: string[];
  files: PackageFile[];
  sha256hash: string;
  compatibility?: PackageCompatibility | null;
  capabilities?: PackageCapabilities | null;
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
  topics?: string[];
  createdAt: number;
  updatedAt: number;
  latestVersion?: string | null;
  capabilityTags?: string[];
  executesCode?: boolean;
  verificationTier?: string | null;
};

export type PackageDetail = {
  package:
    | (PackageListItem & {
        tags?: Record<string, string>;
        compatibility?: PackageCompatibility | null;
        capabilities?: PackageCapabilities | null;
        versions?: PackageVersionSummary[];
        stats?: {
          downloads: number;
          installs: number;
          stars: number;
          versions: number;
        };
      })
    | null;
  owner?: {
    handle?: string | null;
    displayName?: string | null;
    image?: string | null;
  } | null;
};

export type AuthUser = {
  id: string;
  handle: string;
  email: string;
};

export type ApiTokenSummary = {
  id: string;
  name: string;
  createdAt: number;
  lastUsedAt: number | null;
};

export type PublishPayload = {
  name: string;
  displayName?: string;
  family: PackageFamily;
  version: string;
  summary?: string;
  compatibility?: {
    pluginApi?: string;
    minGatewayVersion?: string;
  };
  files: Array<{
    path: string;
    content: string;
    contentType?: string;
  }>;
};

export type PublishArchiveMetadata = {
  name?: string;
  displayName?: string;
  family?: PackageFamily;
  version?: string;
  summary?: string;
  tags?: string[];
  compatibility?: {
    pluginApi?: string;
    minGatewayVersion?: string;
  };
};
