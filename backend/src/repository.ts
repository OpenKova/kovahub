import { createHash } from "node:crypto";
import { strToU8, zipSync } from "fflate";
import {
  normalizeCompatibility,
  toPackageListItem,
  type PackageCapabilitySummary,
  type PackageChannel,
  type PackageCompatibility,
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
  listPackages(options?: ListPackagesOptions): Promise<{ items: PackageListItem[]; nextCursor: string | null }>;
  searchPackages(options: SearchPackagesOptions): Promise<Array<{ score: number; package: PackageListItem }>>;
  getPackage(name: string): Promise<PackageRecord | null>;
  getPackageVersion(name: string, version: string): Promise<{ pkg: PackageRecord; version: PackageVersionRecord } | null>;
  publishPackage(input: PreparedPublishPackageInput, owner: AuthPrincipal): Promise<PackageRecord>;
  updatePackageSettings(name: string, user: AuthPrincipal, input: PackageSettingsInput): Promise<PackageRecord | null>;
  renamePackage(name: string, user: AuthPrincipal, newName: string): Promise<PackageRecord | null>;
  transferPackage(name: string, user: AuthPrincipal, targetHandle: string): Promise<PackageRecord | null>;
  setPackageDeleted(name: string, user: AuthPrincipal, deleted: boolean): Promise<PackageRecord | null>;
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
  updatePackageModeration(name: string, reviewer: AuthPrincipal, input: PackageModerationInput): Promise<PackageRecord | null>;
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
  return [
    pkg.name,
    pkg.displayName,
    pkg.summary ?? "",
    pkg.ownerHandle ?? "",
    ...(pkg.topics ?? []),
    ...(pkg.capabilityTags ?? []),
  ].some((value) => value.toLowerCase().includes(q));
}

function scorePackage(pkg: PackageRecord, query: string) {
  const q = query.trim().toLowerCase();
  const signalBoost = Math.log1p(discoveryScore(pkg));
  if (!q || q === "*") return 1 + signalBoost;
  if (pkg.name.toLowerCase() === q) return 100 + signalBoost;
  if (pkg.name.toLowerCase().includes(q)) return 80 + signalBoost;
  if (pkg.displayName.toLowerCase().includes(q)) return 60 + signalBoost;
  if ((pkg.topics ?? []).some((tag) => tag.toLowerCase() === q)) return 50 + signalBoost;
  if ((pkg.summary ?? "").toLowerCase().includes(q)) return 30 + signalBoost;
  return 10 + signalBoost;
}

function normalizeTopic(value: string) {
  return value.trim().toLowerCase().replace(/^#/, "");
}

export function normalizeTopics(values: string[] = []) {
  return [...new Set(values.map(normalizeTopic).filter(Boolean))];
}

function assertPackageOwner(pkg: PackageRecord, user: AuthPrincipal) {
  if (normalizeKey(pkg.ownerHandle ?? "") !== normalizeKey(user.handle)) {
    throw new Error("Only the package owner can manage this package.");
  }
}

function latestActiveVersion(versions: PackageVersionRecord[]) {
  return versions.find((version) => !version.yankedAt) ?? null;
}

export function mergeVerification(
  current: PackageVerificationSummary | null | undefined,
  input: PackageModerationInput,
): PackageVerificationSummary {
  return {
    tier: current?.tier ?? "structural",
    scope: current?.scope ?? "artifact-only",
    ...current,
    ...(input.moderationStatus !== undefined ? { moderationStatus: input.moderationStatus } : {}),
    ...(input.scanStatus !== undefined ? { scanStatus: input.scanStatus } : {}),
    ...(input.riskLevel !== undefined ? { riskLevel: input.riskLevel } : {}),
    ...(input.summary !== undefined ? { summary: input.summary ?? undefined } : {}),
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
}): PackageVerificationSummary {
  const moderationStatus = input.payload.channel === "official" ? "approved" : "pending";
  return {
    tier: "structural",
    scope: "artifact-only",
    summary:
      moderationStatus === "approved"
        ? "Structural validation passed; automated security scan is queued."
        : "Structural validation passed; moderation and automated security scan are queued.",
    scanStatus: "pending",
    moderationStatus,
    riskLevel: input.capabilities?.executesCode ? "unknown" : "low",
  };
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
  return {
    version: input.payload.version,
    createdAt: now(),
    changelog: input.payload.changelog,
    distTags: ["latest"],
    files: input.payload.archiveFiles ?? buildFileMetadata(sourceFiles),
    sha256hash: sha256Hex(archive),
    compatibility: input.compatibility,
    capabilities: input.capabilities,
    verification: createVerificationSummary(input),
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
  private readonly packages = new Map<string, PackageRecord>();
  private readonly packageStars = new Map<string, { packageName: string; userId: string; createdAt: number }>();
  private readonly packageComments = new Map<string, PackageCommentRecord>();
  private readonly packageReports = new Map<string, PackageReportRecord>();

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
    return user ? { id: user.id, handle: user.handle, email: user.email } : null;
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
      .map((pkg) => ({ score: scorePackage(pkg, options.q), package: toPackageListItem(pkg) }))
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
    const existing = this.packages.get(key);

    if (existing) {
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
      ownerHandle: input.ownerHandle ?? owner.handle,
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
    assertPackageOwner(pkg, user);
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
    assertPackageOwner(pkg, user);
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
    assertPackageOwner(pkg, user);
    const target = await this.findUserByHandle(targetHandle);
    if (!target) throw new Error("Target publisher does not exist.");
    pkg.ownerHandle = target.handle;
    pkg.updatedAt = now();
    return pkg;
  }

  async setPackageDeleted(name: string, user: AuthPrincipal, deleted: boolean) {
    const pkg = await this.getPackage(name);
    if (!pkg) return null;
    assertPackageOwner(pkg, user);
    pkg.deletedAt = deleted ? now() : null;
    pkg.updatedAt = now();
    return pkg;
  }

  async yankPackageVersion(name: string, version: string, user: AuthPrincipal, message?: string | null) {
    const pkg = await this.getPackage(name);
    if (!pkg) return null;
    assertPackageOwner(pkg, user);
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
      createdAt: now(),
    };
    this.packageReports.set(report.id, report);
    pkg.verification = {
      tier: pkg.verification?.tier ?? "structural",
      scope: pkg.verification?.scope ?? "artifact-only",
      ...pkg.verification,
      moderationStatus: pkg.verification?.moderationStatus === "approved" ? "pending" : pkg.verification?.moderationStatus ?? "pending",
      summary: "A community report is queued for moderation review.",
    };
    return report;
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

  private sortedPackages(sort?: ListPackagesOptions["sort"]) {
    return [...this.packages.values()].sort((left, right) => comparePackages(left, right, sort));
  }
}
