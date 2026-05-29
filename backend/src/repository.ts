import { createHash, createHmac } from "node:crypto";
import { strToU8, zipSync } from "fflate";
import {
  normalizeCompatibility,
  toPackageListItem,
  type PackageCapabilitySummary,
  type PackageChannel,
  type PackageCompatibility,
  type PackageDocumentation,
  type PackageFamily,
  type PackageFile,
  type PackageListItem,
  type PackageRecord,
  type PackageSettingsInput,
  type PackageVerificationSummary,
  type PackageVersionRecord,
  type PreparedPublishPackageInput,
  type PublishPackageInput,
} from "./contracts.js";
import { scanPackageArtifact, type SecurityScanFile } from "./securityScan.js";
import { searchPackage } from "./search.js";

export type AuthPrincipal = {
  id: string;
  handle: string;
  email: string;
};

export type UserAccount = AuthPrincipal & {
  passwordHash: string;
  githubId?: string | null;
  displayName?: string | null;
  imageUrl?: string | null;
  bio?: string | null;
  websiteUrl?: string | null;
  company?: string | null;
  location?: string | null;
  bannedAt?: number | null;
  banReason?: string | null;
  createdAt: number;
};

export type OrganizationRole = "owner" | "maintainer" | "member";

export type OrganizationRecord = {
  id: string;
  handle: string;
  displayName: string;
  description?: string | null;
  createdAt: number;
};

export type OrganizationMemberRecord = {
  organizationId: string;
  organizationHandle: string;
  userId: string;
  userHandle: string;
  role: OrganizationRole;
  createdAt: number;
};

export type SessionPrincipal = AuthPrincipal & {
  githubId?: string | null;
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

export type UserProfileUpdate = {
  displayName?: string | null;
  imageUrl?: string | null;
  bio?: string | null;
  websiteUrl?: string | null;
  company?: string | null;
  location?: string | null;
};

export type ApiTokenRecord = {
  id: string;
  userId: string;
  name: string;
  tokenHash: string;
  createdAt: number;
  lastUsedAt: number | null;
};

export type DeviceAuthorizationRecord = {
  deviceCode: string;
  userCode: string;
  clientName?: string | null;
  userId?: string | null;
  userHandle?: string | null;
  status: "pending" | "approved" | "consumed" | "expired";
  createdAt: number;
  expiresAt: number;
  approvedAt?: number | null;
  consumedAt?: number | null;
};

export type PackageCommentRecord = {
  id: string;
  packageName: string;
  userId: string;
  userHandle: string;
  body: string;
  reportCount: number;
  hidden: boolean;
  createdAt: number;
  updatedAt: number;
};

export type PackageReportRecord = {
  id: string;
  packageName: string;
  userId: string;
  userHandle: string;
  reason: string;
  status: "open" | "reviewed" | "dismissed";
  resolution?: string | null;
  resolvedById?: string | null;
  resolvedByHandle?: string | null;
  resolvedAt?: number | null;
  assignedToId?: string | null;
  assignedToHandle?: string | null;
  assignedAt?: number | null;
  createdAt: number;
};

export type NotificationRecord = {
  id: string;
  userId: string;
  type: "package_reported" | "report_assigned" | "report_resolved" | "package_moderated";
  title: string;
  body?: string | null;
  packageName?: string | null;
  reportId?: string | null;
  readAt?: number | null;
  createdAt: number;
};

export type ListPackagesOptions = {
  q?: string;
  family?: PackageFamily;
  families?: PackageFamily[];
  owner?: string;
  tag?: string;
  sort?: "recent" | "popular" | "trending";
  limit?: number;
  cursor?: string;
  includeDeleted?: boolean;
};

export type SearchPackagesOptions = {
  q: string;
  family?: PackageFamily;
  families?: PackageFamily[];
  owner?: string;
  tag?: string;
  limit?: number;
};

export type ListPackageReportsOptions = {
  status?: PackageReportRecord["status"];
  limit?: number;
  cursor?: string;
};

export type ListNotificationsOptions = {
  unreadOnly?: boolean;
  limit?: number;
  cursor?: string;
};

export type PackageReportUpdateInput = {
  status: PackageReportRecord["status"];
  resolution?: string | null;
  moderationStatus?: PackageVerificationSummary["moderationStatus"];
};

export type PackageModerationInput = {
  moderationStatus?: PackageVerificationSummary["moderationStatus"];
  scanStatus?: PackageVerificationSummary["scanStatus"];
  riskLevel?: PackageVerificationSummary["riskLevel"];
  summary?: string | null;
  tier?: PackageVerificationSummary["tier"];
  scope?: PackageVerificationSummary["scope"];
  scanner?: PackageVerificationSummary["scanner"];
  rebuild?: PackageVerificationSummary["rebuild"];
};

export type OrganizationInput = {
  handle: string;
  displayName?: string;
  description?: string | null;
};

export type RegistryRepository = {
  close?(): Promise<void>;
  createUser(input: { handle: string; email: string; passwordHash: string }): Promise<UserAccount>;
  findOrCreateGitHubUser(input: {
    githubId: string;
    login: string;
    email: string;
    displayName?: string | null;
    imageUrl?: string | null;
  }): Promise<UserAccount>;
  findUserByEmail(email: string): Promise<UserAccount | null>;
  findUserByHandle(handle: string): Promise<UserAccount | null>;
  findUserById(id: string): Promise<UserAccount | null>;
  restoreSessionUser?(input: SessionPrincipal): Promise<UserAccount | null>;
  updateUserProfile(userId: string, input: UserProfileUpdate): Promise<UserAccount>;
  createApiToken(input: { userId: string; name: string; tokenHash: string }): Promise<ApiTokenRecord>;
  listApiTokens(userId: string): Promise<ApiTokenRecord[]>;
  revokeApiToken(input: { userId: string; tokenId: string }): Promise<boolean>;
  findUserByApiTokenHash(tokenHash: string): Promise<AuthPrincipal | null>;
  createDeviceAuthorization(input: { deviceCode: string; userCode: string; clientName?: string | null; expiresAt: number }): Promise<DeviceAuthorizationRecord>;
  approveDeviceAuthorization(userCode: string, user: AuthPrincipal): Promise<DeviceAuthorizationRecord | null>;
  getDeviceAuthorization(deviceCode: string): Promise<DeviceAuthorizationRecord | null>;
  consumeDeviceAuthorization(deviceCode: string): Promise<DeviceAuthorizationRecord | null>;
  createOrganization(user: AuthPrincipal, input: OrganizationInput): Promise<OrganizationRecord>;
  listUserOrganizations(userId: string): Promise<OrganizationRecord[]>;
  getOrganizationByHandle(handle: string): Promise<OrganizationRecord | null>;
  listOrganizationMembers(handle: string): Promise<OrganizationMemberRecord[]>;
  addOrganizationMember(handle: string, actor: AuthPrincipal, memberHandle: string, role: OrganizationRole): Promise<OrganizationMemberRecord | null>;
  setUserBan(handle: string, reviewer: AuthPrincipal, input: { banned: boolean; reason?: string | null }): Promise<UserAccount | null>;
  listPackages(options?: ListPackagesOptions): Promise<{ items: PackageListItem[]; nextCursor: string | null }>;
  searchPackages(options: SearchPackagesOptions): Promise<Array<{ score: number; package: PackageListItem; matchedFields?: string[]; highlights?: string[] }>>;
  getPackage(name: string): Promise<PackageRecord | null>;
  getPackageVersion(name: string, version: string): Promise<{ pkg: PackageRecord; version: PackageVersionRecord } | null>;
  publishPackage(input: PreparedPublishPackageInput, owner: AuthPrincipal): Promise<PackageRecord>;
  updatePackageSettings(name: string, user: AuthPrincipal, input: PackageSettingsInput): Promise<PackageRecord | null>;
  renamePackage(name: string, user: AuthPrincipal, newName: string): Promise<PackageRecord | null>;
  transferPackage(name: string, user: AuthPrincipal, targetHandle: string): Promise<PackageRecord | null>;
  setPackageDeleted(name: string, user: AuthPrincipal, deleted: boolean): Promise<PackageRecord | null>;
  hardDeletePackage(name: string, reviewer: AuthPrincipal): Promise<boolean>;
  mergePackage(sourceName: string, targetName: string, reviewer: AuthPrincipal): Promise<PackageRecord | null>;
  yankPackageVersion(name: string, version: string, user: AuthPrincipal, message?: string | null): Promise<PackageRecord | null>;
  getArchive(name: string, selector?: { version?: string; tag?: string }): Promise<{ pkg: PackageRecord; version: PackageVersionRecord } | null>;
  recordDownload(name: string): Promise<void>;
  recordInstall(name: string): Promise<void>;
  recordStar(name: string): Promise<void>;
  getPackageStar(name: string, userId: string): Promise<boolean>;
  togglePackageStar(name: string, user: AuthPrincipal): Promise<{ pkg: PackageRecord; starred: boolean } | null>;
  listStarredPackages(userId: string, options?: { limit?: number; cursor?: string }): Promise<{ items: PackageListItem[]; nextCursor: string | null }>;
  listPackageComments(name: string, options?: { limit?: number; cursor?: string }): Promise<{ items: PackageCommentRecord[]; nextCursor: string | null }>;
  addPackageComment(name: string, user: AuthPrincipal, body: string): Promise<PackageCommentRecord | null>;
  reportPackage(name: string, user: AuthPrincipal, reason: string): Promise<PackageReportRecord | null>;
  listPackageReports(options?: ListPackageReportsOptions): Promise<{ items: PackageReportRecord[]; nextCursor: string | null }>;
  updatePackageReport(reportId: string, reviewer: AuthPrincipal, input: PackageReportUpdateInput): Promise<PackageReportRecord | null>;
  assignPackageReport(reportId: string, reviewer: AuthPrincipal, assigneeHandle: string): Promise<PackageReportRecord | null>;
  updatePackageModeration(name: string, reviewer: AuthPrincipal, input: PackageModerationInput): Promise<PackageRecord | null>;
  createNotification(input: Omit<NotificationRecord, "id" | "createdAt" | "readAt">): Promise<NotificationRecord>;
  listNotifications(userId: string, options?: ListNotificationsOptions): Promise<{ items: NotificationRecord[]; nextCursor: string | null }>;
  markNotificationRead(userId: string, notificationId: string): Promise<NotificationRecord | null>;
};

export type ArchiveFileInput = {
  path: string;
  content?: string;
  contentBase64?: string;
  contentType?: string;
};

function now() {
  return Date.now();
}

export function autoHideReportThreshold() {
  const value = Number.parseInt(process.env.KOVAHUB_AUTO_HIDE_REPORT_THRESHOLD ?? "3", 10);
  return Number.isFinite(value) && value > 0 ? value : 3;
}

function newId(prefix: string) {
  return `${prefix}_${createHash("sha256").update(`${prefix}:${now()}:${Math.random()}`).digest("hex").slice(0, 24)}`;
}

function sha256Hex(bytes: Uint8Array | Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function normalizeKey(value: string) {
  return value.trim().toLowerCase();
}

function normalizeHandle(value: string) {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .replace(/-{2,}/g, "-") || "github-user"
  );
}

function fileBytes(input: ArchiveFileInput) {
  if (input.contentBase64) return Buffer.from(input.contentBase64, "base64");
  return Buffer.from(input.content ?? "", "utf8");
}

function markdownContentFor(file: ArchiveFileInput) {
  const isMarkdown =
    file.contentType === "text/markdown" ||
    file.path.toLowerCase().endsWith(".md") ||
    file.path.toLowerCase().endsWith(".markdown");
  if (!isMarkdown) return undefined;
  if (file.content !== undefined) return file.content;
  if (file.contentBase64 !== undefined) return fileBytes(file).toString("utf8");
  return undefined;
}

function documentationFromFiles(files: ArchiveFileInput[]): PackageDocumentation | null {
  const readme = files.find((file) => /^readme\.(md|markdown)$/i.test(file.path.split("/").pop() ?? ""));
  const skill = files.find((file) => /^skill\.md$/i.test(file.path.split("/").pop() ?? ""));
  const documentation: PackageDocumentation = {
    readmePath: readme?.path,
    readmeMarkdown: readme ? markdownContentFor(readme) : undefined,
    skillPath: skill?.path,
    skillMarkdown: skill ? markdownContentFor(skill) : undefined,
  };
  return Object.values(documentation).some(Boolean) ? documentation : null;
}

function scanFilesFromArchiveFiles(files: ArchiveFileInput[]): SecurityScanFile[] {
  return files.map((file) => ({
    path: file.path,
    content: file.content,
    contentBase64: file.contentBase64,
    contentType: file.contentType,
    size: fileBytes(file).byteLength,
  }));
}

export function buildArchive(files: ArchiveFileInput[]) {
  const entries: Record<string, Uint8Array> = {};
  for (const file of files) {
    entries[file.path] = fileBytes(file);
  }
  return Buffer.from(zipSync(entries, { level: 6 }));
}

export function buildFileMetadata(files: ArchiveFileInput[]): PackageFile[] {
  return files.map((file) => {
    const bytes = fileBytes(file);
    return {
      path: file.path,
      size: bytes.byteLength,
      sha256: sha256Hex(bytes),
      contentType: file.contentType,
    };
  });
}

function packageMatches(pkg: PackageRecord, query: string) {
  const q = query.trim().toLowerCase();
  if (!q || q === "*") return true;
  return searchPackage(pkg, query, discoveryScore(pkg)).score > Math.log1p(discoveryScore(pkg));
}

function scorePackage(pkg: PackageRecord, query: string) {
  return searchPackage(pkg, query, discoveryScore(pkg));
}

function normalizeTopic(value: string) {
  return value.trim().toLowerCase().replace(/^#/, "");
}

export function normalizeTopics(values: string[] = []) {
  return [...new Set(values.map(normalizeTopic).filter(Boolean))];
}

function latestActiveVersion(versions: PackageVersionRecord[]) {
  return versions.find((version) => !version.yankedAt) ?? null;
}

function canPublishForRole(role: OrganizationRole | null | undefined) {
  return role === "owner" || role === "maintainer";
}

export function mergeVerification(
  current: PackageVerificationSummary | null | undefined,
  input: PackageModerationInput,
): PackageVerificationSummary {
  return {
    tier: current?.tier ?? "structural",
    scope: current?.scope ?? "artifact-only",
    ...current,
    ...(input.tier !== undefined ? { tier: input.tier } : {}),
    ...(input.scope !== undefined ? { scope: input.scope } : {}),
    ...(input.moderationStatus !== undefined ? { moderationStatus: input.moderationStatus } : {}),
    ...(input.scanStatus !== undefined ? { scanStatus: input.scanStatus } : {}),
    ...(input.riskLevel !== undefined ? { riskLevel: input.riskLevel } : {}),
    ...(input.summary !== undefined ? { summary: input.summary ?? undefined } : {}),
    ...(input.scanner !== undefined ? { scanner: input.scanner } : {}),
    ...(input.rebuild !== undefined ? { rebuild: input.rebuild } : {}),
  };
}

function discoveryScore(pkg: PackageRecord) {
  return (
    (pkg.stats?.downloads ?? 0) +
    (pkg.stats?.installs ?? 0) * 3 +
    (pkg.stats?.stars ?? 0) * 8 +
    (pkg.isOfficial ? 25 : 0)
  );
}

function comparePackages(left: PackageRecord, right: PackageRecord, sort: ListPackagesOptions["sort"] = "recent") {
  if (sort === "popular") {
    return (
      (right.stats?.stars ?? 0) - (left.stats?.stars ?? 0) ||
      (right.stats?.downloads ?? 0) - (left.stats?.downloads ?? 0) ||
      (right.stats?.installs ?? 0) - (left.stats?.installs ?? 0) ||
      right.updatedAt - left.updatedAt ||
      left.displayName.localeCompare(right.displayName)
    );
  }
  if (sort === "trending") {
    return (
      discoveryScore(right) - discoveryScore(left) ||
      right.updatedAt - left.updatedAt ||
      left.displayName.localeCompare(right.displayName)
    );
  }
  return (
    Number(right.isOfficial) - Number(left.isOfficial) ||
    right.updatedAt - left.updatedAt ||
    left.displayName.localeCompare(right.displayName)
  );
}

export function defaultFilesFor(input: PublishPackageInput) {
  if (input.files.length > 0) return input.files;
  const displayName = input.displayName ?? input.name;
  const metadata = {
    name: input.name,
    version: input.version,
    family: input.family,
    kova: {
      compat: input.compatibility
        ? {
            pluginApi: input.compatibility.pluginApi ?? input.compatibility.pluginApiRange,
            minGatewayVersion: input.compatibility.minGatewayVersion,
          }
        : undefined,
      build: input.compatibility?.builtWithKovaVersion
        ? {
            kovaVersion: input.compatibility.builtWithKovaVersion,
          }
        : undefined,
    },
  };
  return [
    {
      path: "README.md",
      content: `# ${displayName}\n\n${input.summary ?? "KovaHub package."}\n`,
      contentType: "text/markdown",
    },
    {
      path: "package.json",
      content: `${JSON.stringify(metadata, null, 2)}\n`,
      contentType: "application/json",
    },
  ];
}

export function normalizeCapabilities(
  input: PreparedPublishPackageInput,
  compatibility: PackageCompatibility | null,
): PackageCapabilitySummary | null {
  const base = input.capabilities;
  if (!base && input.family === "skill") return null;
  const executesCode = input.family === "code-plugin" || Boolean(base?.executesCode);
  const capabilityTags = [
    ...new Set(
      [
        ...(base?.capabilityTags ?? []),
        input.family === "code-plugin" ? "plugin:code" : undefined,
        input.family === "bundle-plugin" ? "plugin:bundle" : undefined,
        input.family === "skill" ? "skill" : undefined,
        compatibility?.minGatewayVersion ? "compat:gateway-min" : undefined,
      ].filter((value): value is string => Boolean(value)),
    ),
  ];
  return {
    executesCode,
    runtimeId: base?.runtimeId ?? (input.family === "code-plugin" ? input.name : undefined),
    pluginKind: base?.pluginKind,
    channels: base?.channels,
    providers: base?.providers,
    hooks: base?.hooks,
    bundledSkills: base?.bundledSkills,
    capabilityTags,
    bundleFormat: base?.bundleFormat,
    hostTargets: base?.hostTargets,
  };
}

export function createVerificationSummary(input: {
  payload: PreparedPublishPackageInput;
  capabilities: PackageCapabilitySummary | null;
  files: ArchiveFileInput[];
}): PackageVerificationSummary {
  return input.payload.verification ?? scanPackageArtifact({
    files: scanFilesFromArchiveFiles(input.files),
    executesCode: Boolean(input.capabilities?.executesCode),
    channel: input.payload.channel as PackageChannel,
  });
}

function publishSignaturePayload(input: PreparedPublishPackageInput, sha256hash: string) {
  return `${normalizeKey(input.name)}@${input.version}:${sha256hash}`;
}

function expectedPublishHmac(input: PreparedPublishPackageInput, sha256hash: string) {
  const secret = process.env.KOVAHUB_PUBLISH_SIGNING_SECRET;
  if (!secret) return null;
  return createHmac("sha256", secret).update(publishSignaturePayload(input, sha256hash)).digest("hex");
}

function withArtifactVerification(
  verification: PackageVerificationSummary | null | undefined,
  input: PreparedPublishPackageInput,
  sha256hash: string,
): PackageVerificationSummary {
  const current: PackageVerificationSummary = {
    tier: verification?.tier ?? "structural",
    scope: verification?.scope ?? "artifact-only",
    ...verification,
  };
  const provided = input.signature;
  if (provided) {
    if (provided.algorithm === "sha256") {
      current.signature = {
        algorithm: "sha256",
        digest: provided.digest,
        keyId: provided.keyId,
        signer: provided.signer,
        signedAt: provided.signedAt,
        verified: provided.digest === sha256hash,
        reason: provided.digest === sha256hash ? "Artifact digest matches publish signature metadata." : "Artifact digest does not match publish signature metadata.",
      };
    } else {
      const expected = expectedPublishHmac(input, sha256hash);
      current.signature = {
        algorithm: "hmac-sha256",
        digest: sha256hash,
        signature: provided.signature,
        keyId: provided.keyId,
        signer: provided.signer,
        signedAt: provided.signedAt,
        verified: Boolean(expected && provided.signature === expected),
        reason: expected
          ? provided.signature === expected
            ? "HMAC publish signature verified."
            : "HMAC publish signature did not match."
          : "KOVAHUB_PUBLISH_SIGNING_SECRET is not configured.",
      };
    }
  } else {
    const serverSignature = expectedPublishHmac(input, sha256hash);
    if (serverSignature) {
      current.signature = {
        algorithm: "hmac-sha256",
        digest: sha256hash,
        signature: serverSignature,
        keyId: process.env.KOVAHUB_PUBLISH_SIGNING_KEY_ID,
        signer: "kovahub-registry",
        signedAt: now(),
        verified: true,
        reason: "Registry generated publish receipt signature.",
      };
    }
  }
  return current;
}

export function createPackageVersion(input: {
  payload: PreparedPublishPackageInput;
  compatibility: PackageCompatibility | null;
  capabilities: PackageCapabilitySummary | null;
}): PackageVersionRecord {
  const sourceFiles = defaultFilesFor(input.payload);
  const archive = input.payload.archiveBuffer
    ? input.payload.archiveBuffer
    : input.payload.archiveBase64
      ? Buffer.from(input.payload.archiveBase64, "base64")
      : buildArchive(sourceFiles);
  const sha256hash = sha256Hex(archive);
  const verification = createVerificationSummary({ ...input, files: sourceFiles });
  return {
    version: input.payload.version,
    createdAt: now(),
    changelog: input.payload.changelog,
    distTags: ["latest"],
    files: input.payload.archiveFiles ?? buildFileMetadata(sourceFiles),
    sha256hash,
    compatibility: input.compatibility,
    capabilities: input.capabilities,
    verification: withArtifactVerification(verification, input.payload, sha256hash),
    documentation: input.payload.documentation ?? documentationFromFiles(sourceFiles),
    archive,
  };
}

export class InMemoryRegistryRepository implements RegistryRepository {
  private readonly users = new Map<string, UserAccount>();
  private readonly usersByEmail = new Map<string, string>();
  private readonly usersByHandle = new Map<string, string>();
  private readonly usersByGithubId = new Map<string, string>();
  private readonly apiTokens = new Map<string, ApiTokenRecord>();
  private readonly apiTokensByHash = new Map<string, string>();
  private readonly deviceAuthorizations = new Map<string, DeviceAuthorizationRecord>();
  private readonly deviceAuthorizationsByUserCode = new Map<string, string>();
  private readonly organizations = new Map<string, OrganizationRecord>();
  private readonly organizationMembers = new Map<string, OrganizationMemberRecord>();
  private readonly packages = new Map<string, PackageRecord>();
  private readonly packageStars = new Map<string, { packageName: string; userId: string; createdAt: number }>();
  private readonly packageComments = new Map<string, PackageCommentRecord>();
  private readonly packageReports = new Map<string, PackageReportRecord>();
  private readonly notifications = new Map<string, NotificationRecord>();

  async createUser(input: {
    handle: string;
    email: string;
    passwordHash: string;
  }): Promise<UserAccount> {
    const email = normalizeKey(input.email);
    const handle = normalizeKey(input.handle);
    if (this.usersByEmail.has(email)) throw new Error("Email is already registered.");
    if (this.usersByHandle.has(handle)) throw new Error("Handle is already registered.");
    const user: UserAccount = {
      id: newId("user"),
      handle,
      email,
      passwordHash: input.passwordHash,
      githubId: null,
      displayName: null,
      imageUrl: null,
      bio: null,
      websiteUrl: null,
      company: null,
      location: null,
      bannedAt: null,
      banReason: null,
      createdAt: now(),
    };
    this.users.set(user.id, user);
    this.usersByEmail.set(email, user.id);
    this.usersByHandle.set(handle, user.id);
    return user;
  }

  async findOrCreateGitHubUser(input: {
    githubId: string;
    login: string;
    email: string;
    displayName?: string | null;
    imageUrl?: string | null;
  }) {
    const existingGithubUserId = this.usersByGithubId.get(input.githubId);
    const existingGithubUser = existingGithubUserId ? this.users.get(existingGithubUserId) : null;
    if (existingGithubUser) return existingGithubUser;

    const email = normalizeKey(input.email);
    const existingEmailUserId = this.usersByEmail.get(email);
    const existingEmailUser = existingEmailUserId ? this.users.get(existingEmailUserId) : null;
    if (existingEmailUser) {
      if (existingEmailUser.githubId && existingEmailUser.githubId !== input.githubId) {
        throw new Error("Email is already linked to a different GitHub account.");
      }
      existingEmailUser.githubId = input.githubId;
      existingEmailUser.displayName = input.displayName ?? existingEmailUser.displayName ?? null;
      existingEmailUser.imageUrl = input.imageUrl ?? existingEmailUser.imageUrl ?? null;
      this.usersByGithubId.set(input.githubId, existingEmailUser.id);
      return existingEmailUser;
    }

    const baseHandle = normalizeHandle(input.login);
    let handle = baseHandle;
    for (let index = 2; this.usersByHandle.has(handle); index += 1) {
      handle = `${baseHandle}-${index}`;
    }
    const user: UserAccount = {
      id: newId("user"),
      handle,
      email,
      passwordHash: `github-oauth:${input.githubId}`,
      githubId: input.githubId,
      displayName: input.displayName ?? null,
      imageUrl: input.imageUrl ?? null,
      bio: null,
      websiteUrl: null,
      company: null,
      location: null,
      bannedAt: null,
      banReason: null,
      createdAt: now(),
    };
    this.users.set(user.id, user);
    this.usersByEmail.set(user.email, user.id);
    this.usersByHandle.set(user.handle, user.id);
    this.usersByGithubId.set(input.githubId, user.id);
    return user;
  }

  async restoreSessionUser(input: SessionPrincipal) {
    if (!input.githubId) return null;
    const existingById = this.users.get(input.id);
    if (existingById) return existingById;

    const existingGithubUserId = this.usersByGithubId.get(input.githubId);
    const existingGithubUser = existingGithubUserId ? this.users.get(existingGithubUserId) : null;
    if (existingGithubUser) return existingGithubUser;

    const email = normalizeKey(input.email);
    const handle = normalizeHandle(input.handle);
    if (this.usersByEmail.has(email) || this.usersByHandle.has(handle)) return null;

    const user: UserAccount = {
      id: input.id,
      handle,
      email,
      passwordHash: `github-oauth:${input.githubId}`,
      githubId: input.githubId,
      displayName: input.displayName ?? null,
      imageUrl: input.imageUrl ?? null,
      bio: input.bio ?? null,
      websiteUrl: input.websiteUrl ?? null,
      company: input.company ?? null,
      location: input.location ?? null,
      bannedAt: null,
      banReason: null,
      createdAt: typeof input.createdAt === "number" ? input.createdAt : now(),
    };
    this.users.set(user.id, user);
    this.usersByEmail.set(user.email, user.id);
    this.usersByHandle.set(user.handle, user.id);
    this.usersByGithubId.set(input.githubId, user.id);
    return user;
  }

  async findUserByEmail(email: string) {
    const id = this.usersByEmail.get(normalizeKey(email));
    return id ? (this.users.get(id) ?? null) : null;
  }

  async findUserByHandle(handle: string) {
    const id = this.usersByHandle.get(normalizeKey(handle));
    return id ? (this.users.get(id) ?? null) : null;
  }

  async findUserById(id: string) {
    return this.users.get(id) ?? null;
  }

  async updateUserProfile(userId: string, input: UserProfileUpdate) {
    const user = this.users.get(userId);
    if (!user) throw new Error("User does not exist.");
    if ("displayName" in input) user.displayName = input.displayName ?? null;
    if ("imageUrl" in input) user.imageUrl = input.imageUrl ?? null;
    if ("bio" in input) user.bio = input.bio ?? null;
    if ("websiteUrl" in input) user.websiteUrl = input.websiteUrl ?? null;
    if ("company" in input) user.company = input.company ?? null;
    if ("location" in input) user.location = input.location ?? null;
    return user;
  }

  async createApiToken(input: { userId: string; name: string; tokenHash: string }) {
    if (!this.users.has(input.userId)) throw new Error("User does not exist.");
    if (this.apiTokensByHash.has(input.tokenHash)) throw new Error("API token hash already exists.");
    const record: ApiTokenRecord = {
      id: newId("tok"),
      userId: input.userId,
      name: input.name,
      tokenHash: input.tokenHash,
      createdAt: now(),
      lastUsedAt: null,
    };
    this.apiTokens.set(record.id, record);
    this.apiTokensByHash.set(record.tokenHash, record.id);
    return record;
  }

  async listApiTokens(userId: string) {
    return [...this.apiTokens.values()]
      .filter((token) => token.userId === userId)
      .sort((left, right) => right.createdAt - left.createdAt);
  }

  async revokeApiToken(input: { userId: string; tokenId: string }) {
    const token = this.apiTokens.get(input.tokenId);
    if (!token || token.userId !== input.userId) return false;
    this.apiTokens.delete(token.id);
    this.apiTokensByHash.delete(token.tokenHash);
    return true;
  }

  async findUserByApiTokenHash(tokenHash: string) {
    const tokenId = this.apiTokensByHash.get(tokenHash);
    const token = tokenId ? this.apiTokens.get(tokenId) : null;
    if (!token) return null;
    token.lastUsedAt = now();
    const user = this.users.get(token.userId);
    return user && !user.bannedAt ? { id: user.id, handle: user.handle, email: user.email } : null;
  }

  async createDeviceAuthorization(input: {
    deviceCode: string;
    userCode: string;
    clientName?: string | null;
    expiresAt: number;
  }) {
    const record: DeviceAuthorizationRecord = {
      deviceCode: input.deviceCode,
      userCode: input.userCode,
      clientName: input.clientName ?? null,
      status: "pending",
      createdAt: now(),
      expiresAt: input.expiresAt,
      approvedAt: null,
      consumedAt: null,
    };
    this.deviceAuthorizations.set(record.deviceCode, record);
    this.deviceAuthorizationsByUserCode.set(normalizeKey(record.userCode), record.deviceCode);
    return record;
  }

  async approveDeviceAuthorization(userCode: string, user: AuthPrincipal) {
    const deviceCode = this.deviceAuthorizationsByUserCode.get(normalizeKey(userCode));
    const record = deviceCode ? this.deviceAuthorizations.get(deviceCode) : null;
    if (!record) return null;
    if (record.expiresAt <= now()) {
      record.status = "expired";
      return record;
    }
    if (record.status === "consumed") return record;
    record.status = "approved";
    record.userId = user.id;
    record.userHandle = user.handle;
    record.approvedAt = now();
    return record;
  }

  async getDeviceAuthorization(deviceCode: string) {
    const record = this.deviceAuthorizations.get(deviceCode) ?? null;
    if (record?.status === "pending" && record.expiresAt <= now()) record.status = "expired";
    return record;
  }

  async consumeDeviceAuthorization(deviceCode: string) {
    const record = await this.getDeviceAuthorization(deviceCode);
    if (!record || record.status !== "approved") return record;
    record.status = "consumed";
    record.consumedAt = now();
    return record;
  }

  async createOrganization(user: AuthPrincipal, input: OrganizationInput) {
    const handle = normalizeHandle(input.handle);
    if (this.usersByHandle.has(handle) || this.organizations.has(handle)) {
      throw new Error("Publisher handle is already taken.");
    }
    const createdAt = now();
    const organization: OrganizationRecord = {
      id: newId("org"),
      handle,
      displayName: input.displayName?.trim() || handle,
      description: input.description ?? null,
      createdAt,
    };
    this.organizations.set(handle, organization);
    this.organizationMembers.set(this.organizationMemberKey(organization.id, user.id), {
      organizationId: organization.id,
      organizationHandle: organization.handle,
      userId: user.id,
      userHandle: user.handle,
      role: "owner",
      createdAt,
    });
    return organization;
  }

  async listUserOrganizations(userId: string) {
    return [...this.organizationMembers.values()]
      .filter((member) => member.userId === userId)
      .map((member) => this.organizations.get(member.organizationHandle))
      .filter((organization): organization is OrganizationRecord => Boolean(organization))
      .sort((left, right) => left.displayName.localeCompare(right.displayName));
  }

  async getOrganizationByHandle(handle: string) {
    return this.organizations.get(normalizeHandle(handle)) ?? null;
  }

  async listOrganizationMembers(handle: string) {
    const organization = await this.getOrganizationByHandle(handle);
    if (!organization) return [];
    return [...this.organizationMembers.values()]
      .filter((member) => member.organizationId === organization.id)
      .sort((left, right) => {
        const roleRank = { owner: 0, maintainer: 1, member: 2 };
        return roleRank[left.role] - roleRank[right.role] || left.userHandle.localeCompare(right.userHandle);
      });
  }

  async addOrganizationMember(handle: string, actor: AuthPrincipal, memberHandle: string, role: OrganizationRole) {
    const organization = await this.getOrganizationByHandle(handle);
    if (!organization) return null;
    const actorRole = this.organizationMemberRole(organization.id, actor.id);
    if (actorRole !== "owner") throw new Error("Only organization owners can manage members.");
    const member = await this.findUserByHandle(memberHandle);
    if (!member) throw new Error("User does not exist.");
    const record: OrganizationMemberRecord = {
      organizationId: organization.id,
      organizationHandle: organization.handle,
      userId: member.id,
      userHandle: member.handle,
      role,
      createdAt: now(),
    };
    this.organizationMembers.set(this.organizationMemberKey(organization.id, member.id), record);
    return record;
  }

  async setUserBan(handle: string, reviewer: AuthPrincipal, input: { banned: boolean; reason?: string | null }) {
    const user = await this.findUserByHandle(handle);
    if (!user) return null;
    if (user.id === reviewer.id && input.banned) throw new Error("Reviewers cannot ban themselves.");
    user.bannedAt = input.banned ? now() : null;
    user.banReason = input.banned ? input.reason ?? null : null;
    return user;
  }

  async listPackages(options: ListPackagesOptions = {}) {
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);
    const offset = options.cursor ? Number.parseInt(options.cursor, 10) || 0 : 0;
    const filtered = this.sortedPackages(options.sort).filter((pkg) => {
      if (!options.includeDeleted && pkg.deletedAt) return false;
      if (options.family && pkg.family !== options.family) return false;
      if (options.families?.length && !options.families.includes(pkg.family)) return false;
      if (options.owner && normalizeKey(pkg.ownerHandle ?? "") !== normalizeKey(options.owner)) return false;
      if (options.tag && !(pkg.topics ?? []).includes(normalizeTopic(options.tag))) return false;
      if (options.q && !packageMatches(pkg, options.q)) return false;
      return true;
    });
    const page = filtered.slice(offset, offset + limit);
    const nextOffset = offset + page.length;
    return {
      items: page.map(toPackageListItem),
      nextCursor: nextOffset < filtered.length ? String(nextOffset) : null,
    };
  }

  async searchPackages(options: SearchPackagesOptions) {
    const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
    return this.sortedPackages("trending")
      .filter((pkg) => {
        if (pkg.deletedAt) return false;
        if (options.family && pkg.family !== options.family) return false;
        if (options.families?.length && !options.families.includes(pkg.family)) return false;
        if (options.owner && normalizeKey(pkg.ownerHandle ?? "") !== normalizeKey(options.owner)) return false;
        if (options.tag && !(pkg.topics ?? []).includes(normalizeTopic(options.tag))) return false;
        return packageMatches(pkg, options.q);
      })
      .map((pkg) => {
        const match = scorePackage(pkg, options.q);
        return {
          score: match.score,
          matchedFields: match.matchedFields,
          highlights: match.highlights,
          package: toPackageListItem(pkg),
        };
      })
      .sort((left, right) => right.score - left.score || right.package.updatedAt - left.package.updatedAt)
      .slice(0, limit);
  }

  async getPackage(name: string) {
    return this.packages.get(normalizeKey(name)) ?? null;
  }

  async getPackageVersion(name: string, version: string) {
    const pkg = await this.getPackage(name);
    const found = pkg?.versions.find((candidate) => candidate.version === version);
    return pkg && found ? { pkg, version: found } : null;
  }

  async publishPackage(input: PreparedPublishPackageInput, owner: AuthPrincipal) {
    const compatibility = normalizeCompatibility(input.compatibility);
    if (input.family !== "skill") {
      if (!compatibility?.pluginApiRange) {
        throw new Error("Plugin packages require compatibility.pluginApi or compatibility.pluginApiRange.");
      }
      if (!compatibility.minGatewayVersion) {
        throw new Error("Plugin packages require compatibility.minGatewayVersion.");
      }
    }
    const capabilities = normalizeCapabilities(input, compatibility);
    const topics = normalizeTopics(input.tags);
    const key = normalizeKey(input.name);
    const version = createPackageVersion({ payload: input, compatibility, capabilities });
    const publisherHandle = await this.resolvePublisherHandle(input.ownerHandle, owner);
    const existing = this.packages.get(key);

    if (existing) {
      this.assertCanManagePackage(existing, owner);
      if (existing.versions.some((candidate) => candidate.version === input.version)) {
        throw new Error(`Version ${input.version} already exists for ${input.name}.`);
      }
      for (const candidate of existing.versions) {
        candidate.distTags = candidate.distTags.filter((tag) => tag !== "latest");
      }
      existing.versions.unshift(version);
      existing.latestVersion = version.version;
      existing.updatedAt = version.createdAt;
      existing.tags = { ...existing.tags, latest: version.version };
      existing.compatibility = compatibility;
      existing.capabilities = capabilities;
      existing.capabilityTags = capabilities?.capabilityTags;
      existing.executesCode = capabilities?.executesCode;
      existing.topics = topics;
      existing.stats.versions = existing.versions.length;
      return existing;
    }

    const record: PackageRecord = {
      name: input.name,
      displayName: input.displayName ?? input.name,
      family: input.family,
      runtimeId: capabilities?.runtimeId ?? null,
      channel: input.channel as PackageChannel,
      isOfficial: input.channel === "official",
      summary: input.summary ?? null,
      ownerHandle: publisherHandle,
      topics,
      createdAt: version.createdAt,
      updatedAt: version.createdAt,
      latestVersion: version.version,
      capabilityTags: capabilities?.capabilityTags,
      executesCode: capabilities?.executesCode,
      verificationTier: version.verification?.tier ?? null,
      tags: { latest: version.version },
      compatibility,
      capabilities,
      verification: version.verification,
      versions: [version],
      stats: {
        downloads: 0,
        installs: 0,
        stars: 0,
        versions: 1,
      },
      deletedAt: null,
    };
    this.packages.set(key, record);
    return record;
  }

  async updatePackageSettings(name: string, user: AuthPrincipal, input: PackageSettingsInput) {
    const pkg = await this.getPackage(name);
    if (!pkg) return null;
    this.assertCanManagePackage(pkg, user);
    if (input.displayName !== undefined) pkg.displayName = input.displayName;
    if (input.summary !== undefined) pkg.summary = input.summary;
    if (input.tags !== undefined) pkg.topics = normalizeTopics(input.tags);
    if (input.channel !== undefined) {
      pkg.channel = input.channel;
      pkg.isOfficial = input.channel === "official";
    }
    pkg.updatedAt = now();
    return pkg;
  }

  async renamePackage(name: string, user: AuthPrincipal, newName: string) {
    const pkg = await this.getPackage(name);
    if (!pkg) return null;
    this.assertCanManagePackage(pkg, user);
    const oldKey = normalizeKey(pkg.name);
    const nextKey = normalizeKey(newName);
    if (oldKey !== nextKey && this.packages.has(nextKey)) throw new Error("Package name is already taken.");
    this.packages.delete(oldKey);
    pkg.name = newName;
    pkg.updatedAt = now();
    this.packages.set(nextKey, pkg);
    return pkg;
  }

  async transferPackage(name: string, user: AuthPrincipal, targetHandle: string) {
    const pkg = await this.getPackage(name);
    if (!pkg) return null;
    this.assertCanManagePackage(pkg, user);
    pkg.ownerHandle = await this.resolveTransferPublisherHandle(targetHandle, user);
    pkg.updatedAt = now();
    return pkg;
  }

  async setPackageDeleted(name: string, user: AuthPrincipal, deleted: boolean) {
    const pkg = await this.getPackage(name);
    if (!pkg) return null;
    this.assertCanManagePackage(pkg, user);
    pkg.deletedAt = deleted ? now() : null;
    pkg.updatedAt = now();
    return pkg;
  }

  async hardDeletePackage(name: string, _reviewer: AuthPrincipal) {
    const pkg = await this.getPackage(name);
    if (!pkg) return false;
    this.packages.delete(normalizeKey(pkg.name));
    for (const key of [...this.packageStars.keys()]) {
      if (key.startsWith(`${normalizeKey(pkg.name)}:`)) this.packageStars.delete(key);
    }
    for (const [id, comment] of this.packageComments.entries()) {
      if (normalizeKey(comment.packageName) === normalizeKey(pkg.name)) this.packageComments.delete(id);
    }
    for (const [id, report] of this.packageReports.entries()) {
      if (normalizeKey(report.packageName) === normalizeKey(pkg.name)) this.packageReports.delete(id);
    }
    return true;
  }

  async mergePackage(sourceName: string, targetName: string, _reviewer: AuthPrincipal) {
    const source = await this.getPackage(sourceName);
    const target = await this.getPackage(targetName);
    if (!source || !target) return null;
    if (normalizeKey(source.name) === normalizeKey(target.name)) throw new Error("Source and target packages must be different.");
    if (source.family !== target.family) throw new Error("Only packages from the same family can be merged.");

    const preferredLatestVersion = target.latestVersion;
    const targetVersions = new Set(target.versions.map((version) => version.version));
    for (const version of source.versions) {
      if (!targetVersions.has(version.version)) target.versions.push(version);
    }
    target.versions.sort((left, right) => right.createdAt - left.createdAt);
    for (const version of target.versions) version.distTags = version.distTags.filter((tag) => tag !== "latest");
    const latest =
      target.versions.find((version) => version.version === preferredLatestVersion && !version.yankedAt) ??
      latestActiveVersion(target.versions);
    target.latestVersion = latest?.version ?? null;
    if (latest && !latest.distTags.includes("latest")) latest.distTags.push("latest");
    target.versions.sort((left, right) => {
      if (left.version === target.latestVersion) return -1;
      if (right.version === target.latestVersion) return 1;
      return right.createdAt - left.createdAt;
    });
    target.tags = latest ? { ...target.tags, latest: latest.version } : {};
    target.topics = normalizeTopics([...(target.topics ?? []), ...(source.topics ?? [])]);
    target.stats = {
      downloads: target.stats.downloads + source.stats.downloads,
      installs: target.stats.installs + source.stats.installs,
      stars: target.stats.stars + source.stats.stars,
      versions: target.versions.length,
    };
    target.updatedAt = now();

    for (const [key, star] of [...this.packageStars.entries()]) {
      if (normalizeKey(star.packageName) !== normalizeKey(source.name)) continue;
      this.packageStars.delete(key);
      this.packageStars.set(this.packageStarKey(target.name, star.userId), {
        ...star,
        packageName: target.name,
      });
    }
    for (const comment of this.packageComments.values()) {
      if (normalizeKey(comment.packageName) === normalizeKey(source.name)) comment.packageName = target.name;
    }
    for (const report of this.packageReports.values()) {
      if (normalizeKey(report.packageName) === normalizeKey(source.name)) report.packageName = target.name;
    }

    this.packages.delete(normalizeKey(source.name));
    return target;
  }

  async yankPackageVersion(name: string, version: string, user: AuthPrincipal, message?: string | null) {
    const pkg = await this.getPackage(name);
    if (!pkg) return null;
    this.assertCanManagePackage(pkg, user);
    const target = pkg.versions.find((candidate) => candidate.version === version);
    if (!target) return null;
    target.yankedAt = now();
    target.yankMessage = message ?? null;
    target.distTags = target.distTags.filter((tag) => tag !== "latest");
    if (pkg.latestVersion === target.version) {
      const nextLatest = latestActiveVersion(pkg.versions);
      pkg.latestVersion = nextLatest?.version ?? null;
      pkg.tags = nextLatest ? { ...pkg.tags, latest: nextLatest.version } : {};
      if (nextLatest && !nextLatest.distTags.includes("latest")) nextLatest.distTags.push("latest");
    }
    pkg.updatedAt = now();
    return pkg;
  }

  async getArchive(name: string, selector: { version?: string; tag?: string } = {}) {
    const pkg = await this.getPackage(name);
    if (!pkg) return null;
    const targetVersion =
      selector.version ??
      (selector.tag ? pkg.tags[selector.tag] : undefined) ??
      pkg.latestVersion ??
      undefined;
    const version = targetVersion
      ? pkg.versions.find((candidate) => candidate.version === targetVersion)
      : pkg.versions[0];
    if (pkg.deletedAt || version?.yankedAt) return null;
    return version ? { pkg, version } : null;
  }

  async recordDownload(name: string) {
    const pkg = await this.getPackage(name);
    if (pkg) pkg.stats.downloads += 1;
  }

  async recordInstall(name: string) {
    const pkg = await this.getPackage(name);
    if (pkg) pkg.stats.installs += 1;
  }

  async recordStar(name: string) {
    const pkg = await this.getPackage(name);
    if (pkg) pkg.stats.stars += 1;
  }

  async getPackageStar(name: string, userId: string) {
    const pkg = await this.getPackage(name);
    if (!pkg) return false;
    return this.packageStars.has(this.packageStarKey(pkg.name, userId));
  }

  async togglePackageStar(name: string, user: AuthPrincipal) {
    const pkg = await this.getPackage(name);
    if (!pkg) return null;
    const key = this.packageStarKey(pkg.name, user.id);
    const existing = this.packageStars.get(key);
    if (existing) {
      this.packageStars.delete(key);
      pkg.stats.stars = Math.max(0, pkg.stats.stars - 1);
      return { pkg, starred: false };
    }

    this.packageStars.set(key, { packageName: pkg.name, userId: user.id, createdAt: now() });
    pkg.stats.stars += 1;
    return { pkg, starred: true };
  }

  async listStarredPackages(userId: string, options: { limit?: number; cursor?: string } = {}) {
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);
    const offset = options.cursor ? Number.parseInt(options.cursor, 10) || 0 : 0;
    const starred = [...this.packageStars.values()]
      .filter((entry) => entry.userId === userId)
      .sort((left, right) => right.createdAt - left.createdAt)
      .map((entry) => this.packages.get(normalizeKey(entry.packageName)))
      .filter((pkg): pkg is PackageRecord => pkg !== undefined && !pkg.deletedAt);
    const page = starred.slice(offset, offset + limit);
    const nextOffset = offset + page.length;
    return {
      items: page.map(toPackageListItem),
      nextCursor: nextOffset < starred.length ? String(nextOffset) : null,
    };
  }

  async listPackageComments(name: string, options: { limit?: number; cursor?: string } = {}) {
    const pkg = await this.getPackage(name);
    if (!pkg) return { items: [], nextCursor: null };
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);
    const offset = options.cursor ? Number.parseInt(options.cursor, 10) || 0 : 0;
    const comments = [...this.packageComments.values()]
      .filter((comment) => normalizeKey(comment.packageName) === normalizeKey(pkg.name) && !comment.hidden)
      .sort((left, right) => left.createdAt - right.createdAt);
    const page = comments.slice(offset, offset + limit);
    const nextOffset = offset + page.length;
    return {
      items: page,
      nextCursor: nextOffset < comments.length ? String(nextOffset) : null,
    };
  }

  async addPackageComment(name: string, user: AuthPrincipal, body: string) {
    const pkg = await this.getPackage(name);
    const account = await this.findUserById(user.id);
    if (!pkg || !account) return null;
    const createdAt = now();
    const comment: PackageCommentRecord = {
      id: newId("comment"),
      packageName: pkg.name,
      userId: user.id,
      userHandle: account.handle,
      body,
      reportCount: 0,
      hidden: false,
      createdAt,
      updatedAt: createdAt,
    };
    this.packageComments.set(comment.id, comment);
    return comment;
  }

  async reportPackage(name: string, user: AuthPrincipal, reason: string) {
    const pkg = await this.getPackage(name);
    const account = await this.findUserById(user.id);
    if (!pkg || !account) return null;
    const report: PackageReportRecord = {
      id: newId("report"),
      packageName: pkg.name,
      userId: user.id,
      userHandle: account.handle,
      reason,
      status: "open",
      resolution: null,
      resolvedById: null,
      resolvedByHandle: null,
      resolvedAt: null,
      assignedToId: null,
      assignedToHandle: null,
      assignedAt: null,
      createdAt: now(),
    };
    this.packageReports.set(report.id, report);
    const openReports = [...this.packageReports.values()].filter(
      (candidate) => normalizeKey(candidate.packageName) === normalizeKey(pkg.name) && candidate.status === "open",
    ).length;
    pkg.verification = {
      tier: pkg.verification?.tier ?? "structural",
      scope: pkg.verification?.scope ?? "artifact-only",
      ...pkg.verification,
      moderationStatus:
        openReports >= autoHideReportThreshold()
          ? "rejected"
          : pkg.verification?.moderationStatus === "approved"
            ? "pending"
            : pkg.verification?.moderationStatus ?? "pending",
      summary:
        openReports >= autoHideReportThreshold()
          ? "Auto-hidden after community reports reached the review threshold."
          : "A community report is queued for moderation review.",
    };
    if (openReports >= autoHideReportThreshold()) {
      pkg.deletedAt = now();
      pkg.updatedAt = now();
    }
    return report;
  }

  async createNotification(input: Omit<NotificationRecord, "id" | "createdAt" | "readAt">) {
    const record: NotificationRecord = {
      id: newId("note"),
      userId: input.userId,
      type: input.type,
      title: input.title,
      body: input.body ?? null,
      packageName: input.packageName ?? null,
      reportId: input.reportId ?? null,
      readAt: null,
      createdAt: now(),
    };
    this.notifications.set(record.id, record);
    return record;
  }

  async listNotifications(userId: string, options: ListNotificationsOptions = {}) {
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);
    const offset = options.cursor ? Number.parseInt(options.cursor, 10) || 0 : 0;
    const filtered = [...this.notifications.values()]
      .filter((notification) => notification.userId === userId)
      .filter((notification) => (options.unreadOnly ? !notification.readAt : true))
      .sort((left, right) => right.createdAt - left.createdAt);
    const page = filtered.slice(offset, offset + limit);
    const nextOffset = offset + page.length;
    return {
      items: page,
      nextCursor: nextOffset < filtered.length ? String(nextOffset) : null,
    };
  }

  async markNotificationRead(userId: string, notificationId: string) {
    const notification = this.notifications.get(notificationId);
    if (!notification || notification.userId !== userId) return null;
    notification.readAt = notification.readAt ?? now();
    return notification;
  }

  async listPackageReports(options: ListPackageReportsOptions = {}) {
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);
    const offset = options.cursor ? Number.parseInt(options.cursor, 10) || 0 : 0;
    const reports = [...this.packageReports.values()]
      .filter((report) => (options.status ? report.status === options.status : true))
      .sort((left, right) => right.createdAt - left.createdAt);
    const page = reports.slice(offset, offset + limit);
    const nextOffset = offset + page.length;
    return {
      items: page,
      nextCursor: nextOffset < reports.length ? String(nextOffset) : null,
    };
  }

  async updatePackageReport(reportId: string, reviewer: AuthPrincipal, input: PackageReportUpdateInput) {
    const report = this.packageReports.get(reportId);
    if (!report) return null;
    report.status = input.status;
    report.resolution = input.resolution ?? null;
    report.resolvedById = input.status === "open" ? null : reviewer.id;
    report.resolvedByHandle = input.status === "open" ? null : reviewer.handle;
    report.resolvedAt = input.status === "open" ? null : now();

    if (input.moderationStatus) {
      const pkg = await this.getPackage(report.packageName);
      if (pkg) {
        pkg.verification = mergeVerification(pkg.verification, {
          moderationStatus: input.moderationStatus,
          summary: input.resolution ?? pkg.verification?.summary ?? null,
        });
        pkg.updatedAt = now();
      }
    }
    return report;
  }

  async assignPackageReport(reportId: string, _reviewer: AuthPrincipal, assigneeHandle: string) {
    const report = this.packageReports.get(reportId);
    const assignee = await this.findUserByHandle(assigneeHandle);
    if (!report || !assignee) return null;
    report.assignedToId = assignee.id;
    report.assignedToHandle = assignee.handle;
    report.assignedAt = now();
    return report;
  }

  async updatePackageModeration(name: string, _reviewer: AuthPrincipal, input: PackageModerationInput) {
    const pkg = await this.getPackage(name);
    if (!pkg) return null;
    pkg.verification = mergeVerification(pkg.verification, input);
    pkg.updatedAt = now();
    return pkg;
  }

  private packageStarKey(packageName: string, userId: string) {
    return `${normalizeKey(packageName)}:${userId}`;
  }

  private organizationMemberKey(organizationId: string, userId: string) {
    return `${organizationId}:${userId}`;
  }

  private organizationMemberRole(organizationId: string, userId: string) {
    return this.organizationMembers.get(this.organizationMemberKey(organizationId, userId))?.role ?? null;
  }

  private async resolvePublisherHandle(handle: string | undefined, user: AuthPrincipal) {
    const requested = handle?.trim() ? normalizeHandle(handle) : user.handle;
    if (normalizeKey(requested) === normalizeKey(user.handle)) return user.handle;
    const organization = await this.getOrganizationByHandle(requested);
    const role = organization ? this.organizationMemberRole(organization.id, user.id) : null;
    if (!organization || !canPublishForRole(role)) {
      throw new Error("You can only publish as yourself or an organization you maintain.");
    }
    return organization.handle;
  }

  private async resolveTransferPublisherHandle(handle: string, user: AuthPrincipal) {
    const target = await this.findUserByHandle(handle);
    if (target) return target.handle;
    return this.resolvePublisherHandle(handle, user);
  }

  private assertCanManagePackage(pkg: PackageRecord, user: AuthPrincipal) {
    if (normalizeKey(pkg.ownerHandle ?? "") === normalizeKey(user.handle)) return;
    const organization = pkg.ownerHandle ? this.organizations.get(normalizeHandle(pkg.ownerHandle)) : null;
    if (organization && canPublishForRole(this.organizationMemberRole(organization.id, user.id))) return;
    throw new Error("Only the package owner can manage this package.");
  }

  private sortedPackages(sort?: ListPackagesOptions["sort"]) {
    return [...this.packages.values()].sort((left, right) => comparePackages(left, right, sort));
  }
}
