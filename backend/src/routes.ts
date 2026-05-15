import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  packageFamilies,
  publishPackageSchema,
  toPackageListItem,
  type PackageFamily,
  type PackageRecord,
  type PackageVersionRecord,
} from "./contracts.js";
import { requireAuth } from "./auth.js";
import { preparePublishInputFromArchive } from "./packageInspection.js";
import type { RegistryRepository } from "./repository.js";

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
const skillParamsSchema = z.object({ slug: z.string().min(1) });
const publisherParamsSchema = z.object({ handle: z.string().trim().min(1) });
const tagParamsSchema = z.object({ tag: z.string().trim().min(1) });
const versionListQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).optional(),
  cursor: z.string().optional(),
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
    changelog: version.changelog,
    distTags: version.distTags,
  };
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

async function recordPackageSignal(
  reply: FastifyReply,
  repo: RegistryRepository,
  name: string,
  signal: "install" | "star",
) {
  const pkg = await repo.getPackage(name);
  if (!pkg) {
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
  return (process.env.KOVAHUB_REGISTRY ?? process.env.KOVAHUB_REGISTRY_URL ?? "http://localhost:8787").replace(
    /\/+$/,
    "",
  );
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
      env: ["KOVAHUB_REGISTRY", "KOVAHUB_SITE"],
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

  app.get("/api/v1/packages/:name", async (request, reply) => {
    const parsed = packageParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      reply.code(400);
      return { error: "Invalid package name." };
    }
    const pkg = await repo.getPackage(parsed.data.name);
    if (!pkg) {
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
    if (!pkg) {
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
    if (!found) {
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
    if (!pkg || pkg.family !== "skill") {
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
    if (!pkg || pkg.family !== "skill") {
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
