import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  packageFamilies,
  publishPackageSchema,
  type PackageListItem,
  toPackageListItem,
  type PackageFamily,
  type PackageRecord,
  type PackageVersionRecord,
} from "./contracts.js";
import { requireAuth } from "./auth.js";
import { preparePublishInputFromArchive } from "./packageInspection.js";
import type {
  AuthPrincipal,
  OrganizationMemberRecord,
  OrganizationRecord,
  PackageCommentRecord,
  PackageReportRecord,
  RegistryRepository,
  UserAccount,
} from "./repository.js";

const listQuerySchema = z.object({
  q: z.string().optional(),
  family: z.enum(packageFamilies).optional(),
  owner: z.string().trim().min(1).optional(),
  tag: z.string().trim().min(1).optional(),
  sort: z.enum(["recent", "popular", "trending"]).optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  cursor: z.string().optional(),
});

const searchQuerySchema = z.object({
  q: z.string().default("*"),
  family: z.enum(packageFamilies).optional(),
  owner: z.string().trim().min(1).optional(),
  tag: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
});

const packageParamsSchema = z.object({ name: z.string().min(1) });
const packageVersionParamsSchema = packageParamsSchema.extend({ version: z.string().min(1) });
const packageNameLike = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i;
const skillParamsSchema = z.object({ slug: z.string().min(1) });
const publisherParamsSchema = z.object({ handle: z.string().trim().min(1) });
const organizationBodySchema = z.object({
  handle: z.string().trim().min(1).max(80),
  displayName: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(500).nullable().optional(),
});
const organizationMemberBodySchema = z.object({
  handle: z.string().trim().min(1).max(80),
  role: z.enum(["owner", "maintainer", "member"]).default("member"),
});
const tagParamsSchema = z.object({ tag: z.string().trim().min(1) });
const versionListQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).optional(),
  cursor: z.string().optional(),
});
const commentListQuerySchema = versionListQuerySchema;
const commentBodySchema = z.object({
  body: z.string().trim().min(1).max(2000),
});
const packageReportSchema = z.object({
  reason: z.string().trim().min(3).max(1000),
});
const reportListQuerySchema = versionListQuerySchema.extend({
  status: z.enum(["open", "reviewed", "dismissed"]).optional(),
});
const reportParamsSchema = z.object({
  id: z.string().min(1),
});
const reportUpdateSchema = z.object({
  status: z.enum(["open", "reviewed", "dismissed"]),
  resolution: z.string().trim().max(1000).nullable().optional(),
  moderationStatus: z.enum(["pending", "approved", "rejected"]).optional(),
});
const packageModerationSchema = z.object({
  moderationStatus: z.enum(["pending", "approved", "rejected"]).optional(),
  scanStatus: z.enum(["clean", "suspicious", "malicious", "pending", "not-run"]).optional(),
  riskLevel: z.enum(["unknown", "low", "medium", "high"]).optional(),
  summary: z.string().trim().max(500).nullable().optional(),
});
const packageSettingsSchema = z.object({
  displayName: z.string().trim().min(1).max(120).optional(),
  summary: z.string().trim().max(500).nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(48)).optional(),
  channel: z.enum(["community", "private", "official"]).optional(),
});
const packageRenameSchema = z.object({
  name: z.string().trim().min(1).max(214).regex(packageNameLike),
});
const packageTransferSchema = z.object({
  targetHandle: z.string().trim().min(1).max(80),
});
const packageVersionYankSchema = z.object({
  message: z.string().trim().max(500).nullable().optional(),
});
const downloadQuerySchema = z.object({
  version: z.string().optional(),
  tag: z.string().optional(),
});
const skillDownloadQuerySchema = downloadQuerySchema.extend({
  slug: z.string().min(1),
});
const pluginFamilies: PackageFamily[] = ["code-plugin", "bundle-plugin"];

function publicPackageDetail(pkg: PackageRecord) {
  return {
    package: {
      ...toPackageListItem(pkg),
      tags: pkg.tags,
      compatibility: pkg.compatibility ?? null,
      capabilities: pkg.capabilities ?? null,
      verification: pkg.verification ?? null,
      versions: pkg.versions.map(publicVersionSummary),
      stats: pkg.stats,
    },
    owner: {
      handle: pkg.ownerHandle ?? null,
      displayName: pkg.ownerHandle ?? null,
      image: null,
    },
  };
}

function publicVersionSummary(version: PackageVersionRecord) {
  return {
    version: version.version,
    createdAt: version.createdAt,
    yankedAt: version.yankedAt ?? null,
    yankMessage: version.yankMessage ?? null,
    changelog: version.changelog,
    distTags: version.distTags,
    files: version.files,
    compatibility: version.compatibility ?? null,
    capabilities: version.capabilities ?? null,
    verification: version.verification ?? null,
    sha256hash: version.sha256hash,
  };
}

function publicVersionListItem(version: PackageVersionRecord) {
  return {
    version: version.version,
    createdAt: version.createdAt,
    yankedAt: version.yankedAt ?? null,
    yankMessage: version.yankMessage ?? null,
    changelog: version.changelog,
    distTags: version.distTags,
  };
}

function isDeletedPackage(pkg: PackageRecord | null | undefined) {
  return Boolean(pkg?.deletedAt);
}

function publicVersionDetail(pkg: PackageRecord, version: PackageVersionRecord) {
  return {
    package: {
      name: pkg.name,
      displayName: pkg.displayName,
      family: pkg.family,
    },
    version: {
      ...publicVersionSummary(version),
    },
  };
}

function publicPackageComment(comment: PackageCommentRecord) {
  return {
    id: comment.id,
    packageName: comment.packageName,
    user: {
      id: comment.userId,
      handle: comment.userHandle,
    },
    body: comment.body,
    reportCount: comment.reportCount,
    createdAt: comment.createdAt,
    updatedAt: comment.updatedAt,
  };
}

function publicPackageReport(report: PackageReportRecord) {
  return {
    id: report.id,
    packageName: report.packageName,
    user: {
      id: report.userId,
      handle: report.userHandle,
    },
    reason: report.reason,
    status: report.status,
    resolution: report.resolution ?? null,
    resolvedBy: report.resolvedById
      ? {
          id: report.resolvedById,
          handle: report.resolvedByHandle ?? null,
        }
      : null,
    resolvedAt: report.resolvedAt ?? null,
    createdAt: report.createdAt,
  };
}

function publicOrganization(organization: OrganizationRecord) {
  return {
    id: organization.id,
    handle: organization.handle,
    displayName: organization.displayName,
    description: organization.description ?? null,
    createdAt: organization.createdAt,
  };
}

function publicOrganizationMember(member: OrganizationMemberRecord) {
  return {
    organizationHandle: member.organizationHandle,
    user: {
      id: member.userId,
      handle: member.userHandle,
    },
    role: member.role,
    createdAt: member.createdAt,
  };
}

function publicProfile(user: UserAccount, packages: PackageListItem[]) {
  const stats = packages.reduce(
    (accumulator, item) => {
      accumulator.packages += 1;
      if (item.family === "skill") accumulator.skills += 1;
      else accumulator.plugins += 1;
      accumulator.downloads += item.stats?.downloads ?? 0;
      accumulator.installs += item.stats?.installs ?? 0;
      accumulator.stars += item.stats?.stars ?? 0;
      return accumulator;
    },
    { packages: 0, plugins: 0, skills: 0, downloads: 0, installs: 0, stars: 0 },
  );

  return {
    handle: user.handle,
    displayName: user.displayName ?? user.handle,
    imageUrl: user.imageUrl ?? null,
    bio: user.bio ?? null,
    websiteUrl: user.websiteUrl ?? null,
    company: user.company ?? null,
    location: user.location ?? null,
    createdAt: user.createdAt,
    stats,
  };
}

async function listAllPublisherPackages(repo: RegistryRepository, handle: string) {
  const items: PackageListItem[] = [];
  let cursor: string | null = null;
  do {
    const page = await repo.listPackages({ owner: handle, limit: 100, cursor: cursor ?? undefined });
    items.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return items;
}

async function recordPackageSignal(
  reply: FastifyReply,
  repo: RegistryRepository,
  name: string,
  signal: "install" | "star",
) {
  const pkg = await repo.getPackage(name);
  if (!pkg || isDeletedPackage(pkg)) {
    reply.code(404);
    return { package: null, stats: null };
  }
  if (signal === "install") await repo.recordInstall(pkg.name);
  else await repo.recordStar(pkg.name);
  const updated = (await repo.getPackage(pkg.name)) ?? pkg;
  return {
    package: toPackageListItem(updated),
    stats: updated.stats,
  };
}

function configuredReviewerHandles() {
  return [
    process.env.KOVAHUB_REVIEWER_HANDLES,
    process.env.KOVAHUB_ADMIN_HANDLES,
    process.env.KOVAHUB_REVIEWERS,
  ]
    .filter(Boolean)
    .flatMap((value) => value?.split(",") ?? [])
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

function isReviewer(user: AuthPrincipal) {
  const handles = configuredReviewerHandles();
  return handles.includes(user.handle.toLowerCase()) || handles.includes(`@${user.handle.toLowerCase()}`);
}

async function requireReviewer(request: FastifyRequest, reply: FastifyReply, repo: RegistryRepository) {
  const user = await requireAuth(request, reply, repo);
  if (!user) return null;
  if (!isReviewer(user)) {
    reply.code(403).send({ error: "Reviewer access is required." });
    return null;
  }
  return user;
}

function publicSkillDetail(pkg: PackageRecord) {
  const latest = pkg.versions[0];
  return {
    skill: {
      slug: pkg.name,
      displayName: pkg.displayName,
      summary: pkg.summary ?? undefined,
      tags: pkg.tags,
      topics: pkg.topics ?? [],
      createdAt: pkg.createdAt,
      updatedAt: pkg.updatedAt,
    },
    latestVersion: latest
      ? {
          version: latest.version,
          createdAt: latest.createdAt,
          changelog: latest.changelog,
        }
      : null,
    metadata: {
      os: null,
      systems: null,
    },
    owner: {
      handle: pkg.ownerHandle ?? null,
      displayName: pkg.ownerHandle ?? null,
      image: null,
    },
  };
}

function publicSkillListItem(pkg: PackageRecord) {
  const detail = publicSkillDetail(pkg);
  return detail.skill
    ? {
        ...detail.skill,
        latestVersion: detail.latestVersion,
        metadata: detail.metadata,
      }
    : null;
}

function sendArchive(reply: FastifyReply, params: { name: string; version: PackageVersionRecord }) {
  reply
    .header("content-type", "application/zip")
    .header("content-disposition", `attachment; filename="${params.name}-${params.version.version}.zip"`)
    .header("x-kovahub-sha256", params.version.sha256hash);
  return reply.send(params.version.archive);
}

function parseFamily(value: unknown): PackageFamily | undefined {
  return packageFamilies.find((family) => family === value);
}

function registryUrl() {
  return (
    process.env.KOVA_KOVAHUB_URL ??
    process.env.KOVAHUB_URL ??
    process.env.KOVAHUB_REGISTRY ??
    process.env.KOVAHUB_REGISTRY_URL ??
    "http://localhost:8787"
  ).replace(/\/+$/, "");
}

function siteUrl() {
  return (process.env.KOVAHUB_SITE ?? process.env.KOVAHUB_SITE_URL ?? "http://localhost:5173").replace(/\/+$/, "");
}

function paginatedVersionList(versions: PackageVersionRecord[], query: z.infer<typeof versionListQuerySchema>) {
  const limit = Math.min(Math.max(query.limit ?? 50, 1), 100);
  const offset = query.cursor ? Number.parseInt(query.cursor, 10) || 0 : 0;
  const page = versions.slice(offset, offset + limit);
  const nextOffset = offset + page.length;
  return {
    items: page.map(publicVersionListItem),
    nextCursor: nextOffset < versions.length ? String(nextOffset) : null,
  };
}

function parseJsonField(value: string, fieldName: string) {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new Error(`${fieldName} must be valid JSON.`);
  }
}

function setNestedMetadata(metadata: Record<string, unknown>, fieldName: string, value: unknown) {
  const [head, tail] = fieldName.split(".", 2);
  if (!head) return;
  if (!tail) {
    metadata[fieldName] = value;
    return;
  }
  const existing = metadata[head] && typeof metadata[head] === "object" ? metadata[head] : {};
  metadata[head] = {
    ...(existing as Record<string, unknown>),
    [tail]: value,
  };
}

function parseMultipartMetadataValue(fieldName: string, value: string) {
  if (fieldName === "tags") {
    const trimmed = value.trim();
    if (trimmed.startsWith("[")) return parseJsonField(trimmed, fieldName);
    return trimmed.length > 0 ? trimmed.split(",").map((tag) => tag.trim()).filter(Boolean) : [];
  }
  if (fieldName === "compatibility" || fieldName === "capabilities") {
    return parseJsonField(value, fieldName);
  }
  return value;
}

async function parseMultipartPublishInput(request: FastifyRequest) {
  if (!request.isMultipart()) throw new Error("Expected multipart/form-data.");
  let archive: Buffer | null = null;
  const metadata: Record<string, unknown> = {};

  for await (const part of request.parts()) {
    if (part.type === "file") {
      if (part.fieldname !== "archive") throw new Error(`Unexpected file field: ${part.fieldname}.`);
      if (archive) throw new Error("Only one archive file can be uploaded.");
      archive = await part.toBuffer();
      continue;
    }

    const rawValue = part.value;
    const value = typeof rawValue === "string" ? rawValue : String(rawValue ?? "");
    if (part.fieldname === "metadata") {
      const parsed = typeof rawValue === "object" && rawValue !== null ? rawValue : parseJsonField(value, "metadata");
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("metadata must be a JSON object.");
      }
      Object.assign(metadata, parsed);
    } else {
      setNestedMetadata(metadata, part.fieldname, parseMultipartMetadataValue(part.fieldname, value));
    }
  }

  if (!archive) throw new Error("Archive file is required in form field \"archive\".");
  return preparePublishInputFromArchive({ archive, metadata });
}

async function listPackageCatalog(
  request: FastifyRequest,
  reply: FastifyReply,
  repo: RegistryRepository,
  filter: { family?: PackageFamily; families?: PackageFamily[]; owner?: string; tag?: string; sort?: "recent" | "popular" | "trending" } = {},
) {
  const parsed = listQuerySchema.safeParse(request.query);
  if (!parsed.success) {
    reply.code(400);
    return { error: parsed.error.issues[0]?.message ?? "Invalid query." };
  }
  const options = { ...parsed.data, ...filter };
  if (filter.families) delete options.family;
  return repo.listPackages(options);
}

async function searchPackageCatalog(
  request: FastifyRequest,
  reply: FastifyReply,
  repo: RegistryRepository,
  filter: { family?: PackageFamily; families?: PackageFamily[]; owner?: string; tag?: string } = {},
) {
  const parsed = searchQuerySchema.safeParse(request.query);
  if (!parsed.success) {
    reply.code(400);
    return { error: parsed.error.issues[0]?.message ?? "Invalid query." };
  }
  const options = { ...parsed.data, ...filter };
  if (filter.families) delete options.family;
  return { results: await repo.searchPackages(options) };
}

export async function registerRegistryRoutes(app: FastifyInstance, repo: RegistryRepository) {
  app.get("/healthz", async () => ({
    ok: true,
    service: "kovahub",
  }));

  app.get("/api/v1/meta", async () => ({
    name: "KovaHub",
    registry: registryUrl(),
    site: siteUrl(),
    compatibility: {
      env: ["KOVA_KOVAHUB_URL", "KOVAHUB_URL", "KOVAHUB_REGISTRY", "KOVAHUB_SITE"],
      packageCompatibilityFields: ["pluginApiRange", "minGatewayVersion"],
    },
  }));

  app.get("/.well-known/kovahub.json", async () => ({
    name: "KovaHub",
    apiBase: registryUrl(),
    authBase: registryUrl(),
    siteBase: siteUrl(),
    registry: registryUrl(),
    site: siteUrl(),
    minCliVersion: "0.0.1",
    env: {
      url: "KOVAHUB_URL",
      kovaUrl: "KOVA_KOVAHUB_URL",
      registry: "KOVAHUB_REGISTRY",
      site: "KOVAHUB_SITE",
    },
    routes: {
      packages: "/api/v1/packages",
      plugins: "/api/v1/plugins",
      skills: "/api/v1/skills",
      search: "/api/v1/search",
      whoami: "/api/v1/whoami",
    },
  }));

  app.get("/api/v1/packages", async (request, reply) => {
    return listPackageCatalog(request, reply, repo);
  });

  app.get("/api/v1/packages/search", async (request, reply) => {
    return searchPackageCatalog(request, reply, repo);
  });

  app.get("/api/v1/packages/trending", async (request, reply) => {
    return listPackageCatalog(request, reply, repo, { sort: "trending" });
  });

  app.get("/api/v1/stars", async (request, reply) => {
    const user = await requireAuth(request, reply, repo);
    if (!user) return reply;
    const query = versionListQuerySchema.safeParse(request.query);
    if (!query.success) {
      reply.code(400);
      return { error: "Invalid stars list request." };
    }
    return repo.listStarredPackages(user.id, query.data);
  });

  app.get("/api/v1/reviewer/reports", async (request, reply) => {
    const reviewer = await requireReviewer(request, reply, repo);
    if (!reviewer) return reply;
    const query = reportListQuerySchema.safeParse(request.query);
    if (!query.success) {
      reply.code(400);
      return { error: "Invalid moderation report list request." };
    }
    const reports = await repo.listPackageReports(query.data);
    return {
      items: reports.items.map(publicPackageReport),
      nextCursor: reports.nextCursor,
    };
  });

  app.patch("/api/v1/reviewer/reports/:id", async (request, reply) => {
    const reviewer = await requireReviewer(request, reply, repo);
    if (!reviewer) return reply;
    const params = reportParamsSchema.safeParse(request.params);
    const body = reportUpdateSchema.safeParse(request.body);
    if (!params.success || !body.success) {
      reply.code(400);
      return {
        error: body.success
          ? "Invalid moderation report request."
          : body.error.issues[0]?.message ?? "Invalid moderation report payload.",
      };
    }
    const report = await repo.updatePackageReport(params.data.id, reviewer, body.data);
    if (!report) {
      reply.code(404);
      return { report: null };
    }
    return { report: publicPackageReport(report) };
  });

  app.get("/api/v1/me/organizations", async (request, reply) => {
    const user = await requireAuth(request, reply, repo);
    if (!user) return reply;
    const organizations = await repo.listUserOrganizations(user.id);
    return { organizations: organizations.map(publicOrganization) };
  });

  app.post("/api/v1/organizations", async (request, reply) => {
    const user = await requireAuth(request, reply, repo);
    if (!user) return reply;
    const body = organizationBodySchema.safeParse(request.body);
    if (!body.success) {
      reply.code(400);
      return { error: body.error.issues[0]?.message ?? "Invalid organization payload." };
    }
    try {
      const organization = await repo.createOrganization(user, body.data);
      reply.code(201);
      return { organization: publicOrganization(organization) };
    } catch (error) {
      reply.code(400);
      return { error: error instanceof Error ? error.message : "Organization creation failed." };
    }
  });

  app.get("/api/v1/organizations/:handle", async (request, reply) => {
    const params = publisherParamsSchema.safeParse(request.params);
    if (!params.success) {
      reply.code(400);
      return { error: "Invalid organization handle." };
    }
    const organization = await repo.getOrganizationByHandle(params.data.handle);
    if (!organization) {
      reply.code(404);
      return { organization: null };
    }
    return { organization: publicOrganization(organization) };
  });

  app.get("/api/v1/organizations/:handle/members", async (request, reply) => {
    const params = publisherParamsSchema.safeParse(request.params);
    if (!params.success) {
      reply.code(400);
      return { error: "Invalid organization handle." };
    }
    const organization = await repo.getOrganizationByHandle(params.data.handle);
    if (!organization) {
      reply.code(404);
      return { items: [] };
    }
    const members = await repo.listOrganizationMembers(organization.handle);
    return { items: members.map(publicOrganizationMember) };
  });

  app.post("/api/v1/organizations/:handle/members", async (request, reply) => {
    const user = await requireAuth(request, reply, repo);
    if (!user) return reply;
    const params = publisherParamsSchema.safeParse(request.params);
    const body = organizationMemberBodySchema.safeParse(request.body);
    if (!params.success || !body.success) {
      reply.code(400);
      return {
        error: body.success
          ? "Invalid organization member request."
          : body.error.issues[0]?.message ?? "Invalid organization member payload.",
      };
    }
    try {
      const member = await repo.addOrganizationMember(params.data.handle, user, body.data.handle, body.data.role);
      if (!member) {
        reply.code(404);
        return { member: null };
      }
      return { member: publicOrganizationMember(member) };
    } catch (error) {
      reply.code(400);
      return { error: error instanceof Error ? error.message : "Organization member update failed." };
    }
  });

  app.get("/api/v1/profiles/:handle", async (request, reply) => {
    const params = publisherParamsSchema.safeParse(request.params);
    if (!params.success) {
      reply.code(400);
      return { error: "Invalid profile handle." };
    }
    const user = await repo.findUserByHandle(params.data.handle);
    if (!user) {
      reply.code(404);
      return { profile: null };
    }
    const packages = await listAllPublisherPackages(repo, user.handle);
    return { profile: publicProfile(user, packages) };
  });

  app.get("/api/v1/publishers/:handle/packages", async (request, reply) => {
    const params = publisherParamsSchema.safeParse(request.params);
    if (!params.success) {
      reply.code(400);
      return { error: "Invalid publisher handle." };
    }
    return listPackageCatalog(request, reply, repo, { owner: params.data.handle });
  });

  app.get("/api/v1/tags/:tag/packages", async (request, reply) => {
    const params = tagParamsSchema.safeParse(request.params);
    if (!params.success) {
      reply.code(400);
      return { error: "Invalid package tag." };
    }
    return listPackageCatalog(request, reply, repo, { tag: params.data.tag });
  });

  app.get("/api/v1/plugins", async (request, reply) => {
    return listPackageCatalog(request, reply, repo, { families: pluginFamilies });
  });

  app.get("/api/v1/plugins/search", async (request, reply) => {
    return searchPackageCatalog(request, reply, repo, { families: pluginFamilies });
  });

  app.get("/api/v1/code-plugins", async (request, reply) => {
    return listPackageCatalog(request, reply, repo, { family: "code-plugin" });
  });

  app.get("/api/v1/code-plugins/search", async (request, reply) => {
    return searchPackageCatalog(request, reply, repo, { family: "code-plugin" });
  });

  app.get("/api/v1/bundle-plugins", async (request, reply) => {
    return listPackageCatalog(request, reply, repo, { family: "bundle-plugin" });
  });

  app.get("/api/v1/bundle-plugins/search", async (request, reply) => {
    return searchPackageCatalog(request, reply, repo, { family: "bundle-plugin" });
  });

  app.post("/api/v1/packages", async (request, reply) => {
    const user = await requireAuth(request, reply, repo);
    if (!user) return reply;
    let input;
    if (request.isMultipart()) {
      try {
        input = await parseMultipartPublishInput(request);
      } catch (error) {
        reply.code(400);
        return { error: error instanceof Error ? error.message : "Invalid archive publish payload." };
      }
    } else {
      const parsed = publishPackageSchema.safeParse(request.body);
      if (!parsed.success) {
        reply.code(400);
        return { error: parsed.error.issues[0]?.message ?? "Invalid publish payload." };
      }
      input = parsed.data;
    }
    try {
      const pkg = await repo.publishPackage(input, user);
      reply.code(201);
      return publicPackageDetail(pkg);
    } catch (error) {
      reply.code(400);
      return { error: error instanceof Error ? error.message : "Publish failed." };
    }
  });

  app.get("/api/v1/me/packages", async (request, reply) => {
    const user = await requireAuth(request, reply, repo);
    if (!user) return reply;
    const query = versionListQuerySchema.safeParse(request.query);
    if (!query.success) {
      reply.code(400);
      return { error: "Invalid owner package list request." };
    }
    return repo.listPackages({
      owner: user.handle,
      includeDeleted: true,
      limit: query.data.limit,
      cursor: query.data.cursor,
    });
  });

  app.patch("/api/v1/packages/:name/settings", async (request, reply) => {
    const user = await requireAuth(request, reply, repo);
    if (!user) return reply;
    const params = packageParamsSchema.safeParse(request.params);
    const body = packageSettingsSchema.safeParse(request.body);
    if (!params.success || !body.success) {
      reply.code(400);
      return { error: body.success ? "Invalid package settings request." : body.error.issues[0]?.message ?? "Invalid package settings payload." };
    }
    try {
      const pkg = await repo.updatePackageSettings(params.data.name, user, body.data);
      if (!pkg) {
        reply.code(404);
        return { package: null };
      }
      return publicPackageDetail(pkg);
    } catch (error) {
      reply.code(400);
      return { error: error instanceof Error ? error.message : "Package settings update failed." };
    }
  });

  app.post("/api/v1/packages/:name/rename", async (request, reply) => {
    const user = await requireAuth(request, reply, repo);
    if (!user) return reply;
    const params = packageParamsSchema.safeParse(request.params);
    const body = packageRenameSchema.safeParse(request.body);
    if (!params.success || !body.success) {
      reply.code(400);
      return { error: body.success ? "Invalid package rename request." : body.error.issues[0]?.message ?? "Invalid package rename payload." };
    }
    try {
      const pkg = await repo.renamePackage(params.data.name, user, body.data.name);
      if (!pkg) {
        reply.code(404);
        return { package: null };
      }
      return publicPackageDetail(pkg);
    } catch (error) {
      reply.code(400);
      return { error: error instanceof Error ? error.message : "Package rename failed." };
    }
  });

  app.post("/api/v1/packages/:name/transfer", async (request, reply) => {
    const user = await requireAuth(request, reply, repo);
    if (!user) return reply;
    const params = packageParamsSchema.safeParse(request.params);
    const body = packageTransferSchema.safeParse(request.body);
    if (!params.success || !body.success) {
      reply.code(400);
      return { error: body.success ? "Invalid package transfer request." : body.error.issues[0]?.message ?? "Invalid package transfer payload." };
    }
    try {
      const pkg = await repo.transferPackage(params.data.name, user, body.data.targetHandle);
      if (!pkg) {
        reply.code(404);
        return { package: null };
      }
      return publicPackageDetail(pkg);
    } catch (error) {
      reply.code(400);
      return { error: error instanceof Error ? error.message : "Package transfer failed." };
    }
  });

  app.delete("/api/v1/packages/:name", async (request, reply) => {
    const user = await requireAuth(request, reply, repo);
    if (!user) return reply;
    const params = packageParamsSchema.safeParse(request.params);
    if (!params.success) {
      reply.code(400);
      return { error: "Invalid package delete request." };
    }
    try {
      const pkg = await repo.setPackageDeleted(params.data.name, user, true);
      if (!pkg) {
        reply.code(404);
        return { package: null };
      }
      return publicPackageDetail(pkg);
    } catch (error) {
      reply.code(400);
      return { error: error instanceof Error ? error.message : "Package delete failed." };
    }
  });

  app.post("/api/v1/packages/:name/restore", async (request, reply) => {
    const user = await requireAuth(request, reply, repo);
    if (!user) return reply;
    const params = packageParamsSchema.safeParse(request.params);
    if (!params.success) {
      reply.code(400);
      return { error: "Invalid package restore request." };
    }
    try {
      const pkg = await repo.setPackageDeleted(params.data.name, user, false);
      if (!pkg) {
        reply.code(404);
        return { package: null };
      }
      return publicPackageDetail(pkg);
    } catch (error) {
      reply.code(400);
      return { error: error instanceof Error ? error.message : "Package restore failed." };
    }
  });

  app.post("/api/v1/packages/:name/versions/:version/yank", async (request, reply) => {
    const user = await requireAuth(request, reply, repo);
    if (!user) return reply;
    const params = packageVersionParamsSchema.safeParse(request.params);
    const body = packageVersionYankSchema.safeParse(request.body ?? {});
    if (!params.success || !body.success) {
      reply.code(400);
      return { error: body.success ? "Invalid package version yank request." : body.error.issues[0]?.message ?? "Invalid package version yank payload." };
    }
    try {
      const pkg = await repo.yankPackageVersion(params.data.name, params.data.version, user, body.data.message);
      if (!pkg) {
        reply.code(404);
        return { package: null };
      }
      return publicPackageDetail(pkg);
    } catch (error) {
      reply.code(400);
      return { error: error instanceof Error ? error.message : "Package version yank failed." };
    }
  });

  app.patch("/api/v1/packages/:name/moderation", async (request, reply) => {
    const reviewer = await requireReviewer(request, reply, repo);
    if (!reviewer) return reply;
    const params = packageParamsSchema.safeParse(request.params);
    const body = packageModerationSchema.safeParse(request.body);
    if (!params.success || !body.success) {
      reply.code(400);
      return {
        error: body.success
          ? "Invalid package moderation request."
          : body.error.issues[0]?.message ?? "Invalid package moderation payload.",
      };
    }
    const pkg = await repo.updatePackageModeration(params.data.name, reviewer, body.data);
    if (!pkg) {
      reply.code(404);
      return { package: null };
    }
    return publicPackageDetail(pkg);
  });

  app.get("/api/v1/packages/:name", async (request, reply) => {
    const parsed = packageParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      reply.code(400);
      return { error: "Invalid package name." };
    }
    const pkg = await repo.getPackage(parsed.data.name);
    if (!pkg || isDeletedPackage(pkg)) {
      reply.code(404);
      return { package: null, owner: null };
    }
    return publicPackageDetail(pkg);
  });

  app.get("/api/v1/packages/:name/versions", async (request, reply) => {
    const params = packageParamsSchema.safeParse(request.params);
    const query = versionListQuerySchema.safeParse(request.query);
    if (!params.success || !query.success) {
      reply.code(400);
      return { error: "Invalid package version list request." };
    }
    const pkg = await repo.getPackage(params.data.name);
    if (!pkg || isDeletedPackage(pkg)) {
      reply.code(404);
      return { items: [], nextCursor: null };
    }
    return paginatedVersionList(pkg.versions, query.data);
  });

  app.get("/api/v1/packages/:name/versions/:version", async (request, reply) => {
    const parsed = packageVersionParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      reply.code(400);
      return { error: "Invalid package version request." };
    }
    const found = await repo.getPackageVersion(parsed.data.name, parsed.data.version);
    if (!found || isDeletedPackage(found.pkg)) {
      reply.code(404);
      return { package: null, version: null };
    }
    return publicVersionDetail(found.pkg, found.version);
  });

  app.post("/api/v1/packages/:name/install", async (request, reply) => {
    const parsed = packageParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      reply.code(400);
      return { error: "Invalid package install signal." };
    }
    return recordPackageSignal(reply, repo, parsed.data.name, "install");
  });

  app.post("/api/v1/packages/:name/star", async (request, reply) => {
    const parsed = packageParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      reply.code(400);
      return { error: "Invalid package star signal." };
    }
    return recordPackageSignal(reply, repo, parsed.data.name, "star");
  });

  app.get("/api/v1/packages/:name/star", async (request, reply) => {
    const user = await requireAuth(request, reply, repo);
    if (!user) return reply;
    const parsed = packageParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      reply.code(400);
      return { error: "Invalid package star state request." };
    }
    const pkg = await repo.getPackage(parsed.data.name);
    if (!pkg || isDeletedPackage(pkg)) {
      reply.code(404);
      return { starred: false };
    }
    return { starred: await repo.getPackageStar(parsed.data.name, user.id) };
  });

  app.post("/api/v1/packages/:name/star/toggle", async (request, reply) => {
    const user = await requireAuth(request, reply, repo);
    if (!user) return reply;
    const parsed = packageParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      reply.code(400);
      return { error: "Invalid package star request." };
    }
    const pkg = await repo.getPackage(parsed.data.name);
    if (!pkg || isDeletedPackage(pkg)) {
      reply.code(404);
      return { package: null, stats: null, starred: false };
    }
    const result = await repo.togglePackageStar(parsed.data.name, user);
    if (!result) {
      reply.code(404);
      return { package: null, stats: null, starred: false };
    }
    return {
      package: toPackageListItem(result.pkg),
      stats: result.pkg.stats,
      starred: result.starred,
    };
  });

  app.get("/api/v1/packages/:name/comments", async (request, reply) => {
    const params = packageParamsSchema.safeParse(request.params);
    const query = commentListQuerySchema.safeParse(request.query);
    if (!params.success || !query.success) {
      reply.code(400);
      return { error: "Invalid package comments request." };
    }
    const pkg = await repo.getPackage(params.data.name);
    if (!pkg || isDeletedPackage(pkg)) {
      reply.code(404);
      return { items: [], nextCursor: null };
    }
    const comments = await repo.listPackageComments(params.data.name, query.data);
    return {
      items: comments.items.map(publicPackageComment),
      nextCursor: comments.nextCursor,
    };
  });

  app.post("/api/v1/packages/:name/comments", async (request, reply) => {
    const user = await requireAuth(request, reply, repo);
    if (!user) return reply;
    const params = packageParamsSchema.safeParse(request.params);
    const body = commentBodySchema.safeParse(request.body);
    if (!params.success || !body.success) {
      reply.code(400);
      return {
        error: body.success
          ? "Invalid package comments request."
          : body.error.issues[0]?.message ?? "Invalid comment payload.",
      };
    }
    const pkg = await repo.getPackage(params.data.name);
    if (!pkg || isDeletedPackage(pkg)) {
      reply.code(404);
      return { comment: null };
    }
    const comment = await repo.addPackageComment(params.data.name, user, body.data.body);
    if (!comment) {
      reply.code(404);
      return { comment: null };
    }
    reply.code(201);
    return { comment: publicPackageComment(comment) };
  });

  app.post("/api/v1/packages/:name/report", async (request, reply) => {
    const user = await requireAuth(request, reply, repo);
    if (!user) return reply;
    const params = packageParamsSchema.safeParse(request.params);
    const body = packageReportSchema.safeParse(request.body);
    if (!params.success || !body.success) {
      reply.code(400);
      return {
        error: body.success
          ? "Invalid package report request."
          : body.error.issues[0]?.message ?? "Invalid report payload.",
      };
    }
    const pkg = await repo.getPackage(params.data.name);
    if (!pkg || isDeletedPackage(pkg)) {
      reply.code(404);
      return { report: null };
    }
    const report = await repo.reportPackage(params.data.name, user, body.data.reason);
    if (!report) {
      reply.code(404);
      return { report: null };
    }
    reply.code(201);
    return {
      report: publicPackageReport(report),
    };
  });

  app.get("/api/v1/packages/:name/download", async (request, reply) => {
    const params = packageParamsSchema.safeParse(request.params);
    const query = downloadQuerySchema.safeParse(request.query);
    if (!params.success || !query.success) {
      reply.code(400);
      return { error: "Invalid package download request." };
    }
    const found = await repo.getArchive(params.data.name, query.data);
    if (!found) {
      reply.code(404);
      return { error: "Package archive not found." };
    }
    await repo.recordDownload(found.pkg.name);
    return sendArchive(reply, { name: found.pkg.name, version: found.version });
  });

  app.get("/api/v1/search", async (request, reply) => {
    const parsed = searchQuerySchema.safeParse({ ...(request.query as object), family: "skill" });
    if (!parsed.success) {
      reply.code(400);
      return { error: parsed.error.issues[0]?.message ?? "Invalid query." };
    }
    const results = await repo.searchPackages({
      q: parsed.data.q,
      family: "skill",
      limit: parsed.data.limit,
    });
    return {
      results: results.map((result) => ({
        score: result.score,
        slug: result.package.name,
        displayName: result.package.displayName,
        summary: result.package.summary ?? undefined,
        version: result.package.latestVersion ?? undefined,
        updatedAt: result.package.updatedAt,
      })),
    };
  });

  app.get("/api/v1/skills", async (request, reply) => {
    const parsed = listQuerySchema.safeParse({
      ...(request.query as object),
      family: parseFamily("skill"),
    });
    if (!parsed.success) {
      reply.code(400);
      return { error: parsed.error.issues[0]?.message ?? "Invalid query." };
    }
    const page = await repo.listPackages({ ...parsed.data, family: "skill" });
    return {
      items: await Promise.all(
        page.items.map(async (item) => {
          const pkg = await repo.getPackage(item.name);
          return pkg ? publicSkillListItem(pkg) : null;
        }),
      ).then((items) => items.filter(Boolean)),
      nextCursor: page.nextCursor,
    };
  });

  app.get("/api/v1/skills/:slug", async (request, reply) => {
    const parsed = skillParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      reply.code(400);
      return { error: "Invalid skill slug." };
    }
    const pkg = await repo.getPackage(parsed.data.slug);
    if (!pkg || isDeletedPackage(pkg) || pkg.family !== "skill") {
      reply.code(404);
      return { skill: null, latestVersion: null, owner: null };
    }
    return publicSkillDetail(pkg);
  });

  app.get("/api/v1/skills/:slug/versions", async (request, reply) => {
    const params = skillParamsSchema.safeParse(request.params);
    const query = versionListQuerySchema.safeParse(request.query);
    if (!params.success || !query.success) {
      reply.code(400);
      return { error: "Invalid skill version list request." };
    }
    const pkg = await repo.getPackage(params.data.slug);
    if (!pkg || isDeletedPackage(pkg) || pkg.family !== "skill") {
      reply.code(404);
      return { items: [], nextCursor: null };
    }
    return paginatedVersionList(pkg.versions, query.data);
  });

  app.get("/api/v1/download", async (request, reply) => {
    const parsed = skillDownloadQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      reply.code(400);
      return { error: parsed.error.issues[0]?.message ?? "Invalid skill download request." };
    }
    const found = await repo.getArchive(parsed.data.slug, parsed.data);
    if (!found || found.pkg.family !== "skill") {
      reply.code(404);
      return { error: "Skill archive not found." };
    }
    await repo.recordDownload(found.pkg.name);
    return sendArchive(reply, { name: found.pkg.name, version: found.version });
  });
}
