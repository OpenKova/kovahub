export type PackageFamily = "skill" | "code-plugin" | "bundle-plugin";
export type PackageChannel = "official" | "community" | "private";
export type PackageSort = "recent" | "popular" | "trending";

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

export type PackageVerification = {
  tier: "structural" | "source-linked" | "provenance-verified" | "rebuild-verified";
  scope: "artifact-only" | "dependency-graph-aware";
  summary?: string;
  sourceRepo?: string;
  sourceCommit?: string;
  hasProvenance?: boolean;
  scanStatus?: "clean" | "suspicious" | "malicious" | "pending" | "not-run";
  moderationStatus?: "pending" | "approved" | "rejected";
  riskLevel?: "unknown" | "low" | "medium" | "high";
  signature?: {
    algorithm: "sha256" | "hmac-sha256";
    digest?: string;
    signature?: string;
    keyId?: string;
    signer?: string;
    signedAt?: number;
    verified: boolean;
    reason?: string;
  };
  scanner?: {
    provider: "structural" | "webhook" | "manual";
    status: "clean" | "suspicious" | "malicious" | "queued" | "failed" | "not-run";
    checkedAt?: number;
    url?: string;
  };
  rebuild?: {
    status: "not-run" | "queued" | "passed" | "failed";
    checkedAt?: number;
    command?: string;
    logUrl?: string;
    sourceRepo?: string;
    sourceCommit?: string;
  };
  findings?: Array<{
    severity: "low" | "medium" | "high";
    code: string;
    message: string;
    path?: string;
  }>;
};

export type PackageFile = {
  path: string;
  size: number;
  sha256: string;
  contentType?: string;
};

export type PackageDocumentation = {
  readmePath?: string;
  readmeMarkdown?: string;
  skillPath?: string;
  skillMarkdown?: string;
};

export type PackageStats = {
  downloads: number;
  installs: number;
  stars: number;
  versions: number;
};

export type PackageVersionSummary = {
  version: string;
  createdAt: number;
  yankedAt?: number | null;
  yankMessage?: string | null;
  changelog: string;
  distTags: string[];
  files: PackageFile[];
  sha256hash: string;
  compatibility?: PackageCompatibility | null;
  capabilities?: PackageCapabilities | null;
  verification?: PackageVerification | null;
  documentation?: PackageDocumentation | null;
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
  scanStatus?: PackageVerification["scanStatus"] | null;
  moderationStatus?: PackageVerification["moderationStatus"] | null;
  deletedAt?: number | null;
  stats?: PackageStats;
};

export type PackageDetail = {
  package:
    | (PackageListItem & {
        tags?: Record<string, string>;
        compatibility?: PackageCompatibility | null;
        capabilities?: PackageCapabilities | null;
        verification?: PackageVerification | null;
        versions?: PackageVersionSummary[];
        stats?: PackageStats;
      })
    | null;
  owner?: {
    handle?: string | null;
    displayName?: string | null;
    image?: string | null;
  } | null;
};

export type PackageComment = {
  id: string;
  packageName: string;
  user: {
    id: string;
    handle: string;
  };
  body: string;
  reportCount: number;
  createdAt: number;
  updatedAt: number;
};

export type PackageReportStatus = "open" | "reviewed" | "dismissed";

export type PackageReport = {
  id: string;
  packageName: string;
  user: {
    id: string;
    handle: string;
  };
  reason: string;
  status: PackageReportStatus;
  resolution?: string | null;
  resolvedBy?: {
    id: string;
    handle?: string | null;
  } | null;
  resolvedAt?: number | null;
  assignedTo?: {
    id: string;
    handle?: string | null;
  } | null;
  assignedAt?: number | null;
  createdAt: number;
};

export type NotificationItem = {
  id: string;
  type: "package_reported" | "report_assigned" | "report_resolved" | "package_moderated";
  title: string;
  body?: string | null;
  packageName?: string | null;
  reportId?: string | null;
  readAt?: number | null;
  createdAt: number;
};

export type PackageStarState = {
  starred: boolean;
};

export type PackageStarToggleResult = {
  package: PackageListItem | null;
  stats: PackageStats | null;
  starred: boolean;
};

export type AuthUser = {
  id: string;
  handle: string;
  email: string;
  displayName?: string | null;
  imageUrl?: string | null;
  bio?: string | null;
  websiteUrl?: string | null;
  company?: string | null;
  location?: string | null;
  bannedAt?: number | null;
  banReason?: string | null;
  createdAt?: number | null;
};

export type Organization = {
  id: string;
  handle: string;
  displayName: string;
  description?: string | null;
  createdAt: number;
};

export type OrganizationMember = {
  organizationHandle: string;
  user: {
    id: string;
    handle: string;
  };
  role: "owner" | "maintainer" | "member";
  createdAt: number;
};

export type ProfileStats = {
  packages: number;
  plugins: number;
  skills: number;
  downloads: number;
  installs: number;
  stars: number;
};

export type UserProfile = {
  handle: string;
  displayName: string;
  imageUrl?: string | null;
  bio?: string | null;
  websiteUrl?: string | null;
  company?: string | null;
  location?: string | null;
  createdAt: number;
  stats: ProfileStats;
};

export type ProfileUpdatePayload = {
  displayName?: string | null;
  bio?: string | null;
  websiteUrl?: string | null;
  company?: string | null;
  location?: string | null;
};

export type ApiTokenSummary = {
  id: string;
  name: string;
  createdAt: number;
  lastUsedAt: number | null;
};

export type PublishPayload = {
  name: string;
  ownerHandle?: string;
  displayName?: string;
  family: PackageFamily;
  version: string;
  summary?: string;
  compatibility?: {
    pluginApi?: string;
    minGatewayVersion?: string;
  };
  signature?: {
    algorithm?: "sha256" | "hmac-sha256";
    digest?: string;
    signature?: string;
    keyId?: string;
    signer?: string;
    signedAt?: number;
  };
  files: Array<{
    path: string;
    content: string;
    contentType?: string;
  }>;
};

export type PublishArchiveMetadata = {
  name?: string;
  ownerHandle?: string;
  displayName?: string;
  family?: PackageFamily;
  version?: string;
  summary?: string;
  tags?: string[];
  compatibility?: {
    pluginApi?: string;
    minGatewayVersion?: string;
  };
  signature?: PublishPayload["signature"];
};

export type PackageSettingsPayload = {
  displayName?: string;
  summary?: string | null;
  tags?: string[];
  channel?: PackageChannel;
};
