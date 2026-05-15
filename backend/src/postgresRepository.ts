import { readdir, readFile } from "node:fs/promises";
import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { archiveStorageKey, createArchiveStoreFromEnv, type ArchiveStore } from "./archiveStore.js";
import {
  normalizeCompatibility,
  toPackageListItem,
  type PackageCapabilitySummary,
  type PackageChannel,
  type PackageCompatibility,
  type PackageFamily,
  type PackageFile,
  type PackageRecord,
  type PackageSettingsInput,
  type PackageVerificationSummary,
  type PackageVersionRecord,
  type PreparedPublishPackageInput,
} from "./contracts.js";
import {
  createPackageVersion,
  mergeVerification,
  normalizeCapabilities,
  normalizeKey,
  normalizeTopics,
  type ApiTokenRecord,
  type AuthPrincipal,
  type DeviceAuthorizationRecord,
  type ListPackageReportsOptions,
  type ListPackagesOptions,
  type OrganizationInput,
  type OrganizationMemberRecord,
  type OrganizationRecord,
  type OrganizationRole,
  type PackageModerationInput,
  type PackageCommentRecord,
  type PackageReportRecord,
  type PackageReportUpdateInput,
  type RegistryRepository,
  type SearchPackagesOptions,
  type UserAccount,
} from "./repository.js";

type PackageRow = QueryResultRow & {
  id: string;
  name: string;
  display_name: string;
  family: PackageFamily;
  channel: PackageChannel;
  owner_id: string;
  owner_handle: string | null;
  summary: string | null;
  topics: string[];
  runtime_id: string | null;
  latest_version: string | null;
  is_official: boolean;
  compatibility: PackageCompatibility | null;
  capabilities: PackageCapabilitySummary | null;
  verification: PackageVerificationSummary | null;
  stats: Partial<PackageRecord["stats"]> | null;
  deleted_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

type PackageVersionRow = QueryResultRow & {
  id: string;
  version: string;
  changelog: string;
  archive_storage_key: string;
  sha256hash: string;
  dist_tags: string[];
  compatibility: PackageCompatibility | null;
  capabilities: PackageCapabilitySummary | null;
  verification: PackageVerificationSummary | null;
  yanked_at: Date | null;
  yank_message: string | null;
  created_at: Date;
  files: PackageFile[];
};

type UserRow = QueryResultRow & {
  id: string;
  handle: string;
  email: string;
  password_hash: string;
  github_id: string | null;
  display_name: string | null;
  image_url: string | null;
  bio: string | null;
  website_url: string | null;
  company: string | null;
  location: string | null;
  created_at: Date;
};

type ApiTokenRow = QueryResultRow & {
  id: string;
  user_id: string;
  name: string;
  token_hash: string;
  created_at: Date;
  last_used_at: Date | null;
};

type DeviceAuthorizationRow = QueryResultRow & {
  device_code: string;
  user_code: string;
  client_name: string | null;
  user_id: string | null;
  user_handle: string | null;
  status: DeviceAuthorizationRecord["status"];
  created_at: Date;
  expires_at: Date;
  approved_at: Date | null;
  consumed_at: Date | null;
};

type OrganizationRow = QueryResultRow & {
  id: string;
  handle: string;
  display_name: string;
  description: string | null;
  created_at: Date;
};

type OrganizationMemberRow = QueryResultRow & {
  organization_id: string;
  organization_handle: string;
  user_id: string;
  user_handle: string;
  role: OrganizationRole;
  created_at: Date;
};

type PackageCommentRow = QueryResultRow & {
  id: string;
  package_name: string;
  user_id: string;
  user_handle: string;
  body: string;
  report_count: number;
  hidden: boolean;
  created_at: Date;
  updated_at: Date;
};

type PackageReportRow = QueryResultRow & {
  id: string;
  package_name: string;
  user_id: string;
  user_handle: string;
  reason: string;
  status: PackageReportRecord["status"];
  resolution: string | null;
  resolved_by_id: string | null;
  resolved_by_handle: string | null;
  resolved_at: Date | null;
  created_at: Date;
};

const packageColumns = `
    p.id,
    p.name,
    p.display_name,
    p.family,
    p.channel,
    p.owner_id,
    coalesce(p.publisher_handle, u.handle) as owner_handle,
    p.summary,
    p.topics,
    p.runtime_id,
    p.latest_version,
    p.is_official,
    p.compatibility,
    p.capabilities,
    p.verification,
    p.stats,
    p.deleted_at,
    p.created_at,
    p.updated_at
`;

const packageFrom = `
  from packages p
  join users u on u.id = p.owner_id
`;

const packageSelect = `
  select
    ${packageColumns}
    ${packageFrom}
`;

const userColumns = "id, handle, email, password_hash, github_id, display_name, image_url, bio, website_url, company, location, created_at";

function timeMs(value: Date) {
  return value.getTime();
}

function clampLimit(value: number | undefined, fallback: number) {
  return Math.min(Math.max(value ?? fallback, 1), 100);
}

function addParam(params: unknown[], value: unknown) {
  params.push(value);
  return `$${params.length}`;
}

function packageSearchPredicate(param: string) {
  return `(
    to_tsvector('simple', coalesce(p.name, '') || ' ' || coalesce(p.display_name, '') || ' ' || coalesce(p.summary, '') || ' ' || array_to_string(p.topics, ' '))
      @@ plainto_tsquery('simple', ${param})
    or p.name ilike '%' || ${param} || '%'
    or p.display_name ilike '%' || ${param} || '%'
    or coalesce(p.summary, '') ilike '%' || ${param} || '%'
    or exists(select 1 from unnest(p.topics) topic where topic ilike '%' || ${param} || '%')
  )`;
}

function statsInt(field: "downloads" | "installs" | "stars") {
  return `coalesce((p.stats->>'${field}')::int, 0)`;
}

function discoveryScoreExpression() {
  return `(${statsInt("downloads")} + (${statsInt("installs")} * 3) + (${statsInt("stars")} * 8) + case when p.is_official then 25 else 0 end)`;
}

function packageOrderBy(sort: ListPackagesOptions["sort"] = "recent") {
  if (sort === "popular") {
    return `order by ${statsInt("stars")} desc, ${statsInt("downloads")} desc, ${statsInt("installs")} desc, p.updated_at desc, p.display_name asc`;
  }
  if (sort === "trending") {
    return `order by ${discoveryScoreExpression()} desc, p.updated_at desc, p.display_name asc`;
  }
  return "order by p.is_official desc, p.updated_at desc, p.display_name asc";
}

function normalizeStats(stats: Partial<PackageRecord["stats"]> | null): PackageRecord["stats"] {
  return {
    downloads: stats?.downloads ?? 0,
    installs: stats?.installs ?? 0,
    stars: stats?.stars ?? 0,
    versions: stats?.versions ?? 0,
  };
}

function normalizePublisherHandle(value: string) {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .replace(/-{2,}/g, "-") || "publisher"
  );
}

function rowToUser(row: UserRow): UserAccount {
  return {
    id: row.id,
    handle: row.handle,
    email: row.email,
    passwordHash: row.password_hash,
    githubId: row.github_id,
    displayName: row.display_name,
    imageUrl: row.image_url,
    bio: row.bio,
    websiteUrl: row.website_url,
    company: row.company,
    location: row.location,
    createdAt: timeMs(row.created_at),
  };
}

function rowToApiToken(row: ApiTokenRow): ApiTokenRecord {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    tokenHash: row.token_hash,
    createdAt: timeMs(row.created_at),
    lastUsedAt: row.last_used_at ? timeMs(row.last_used_at) : null,
  };
}

function rowToDeviceAuthorization(row: DeviceAuthorizationRow): DeviceAuthorizationRecord {
  const expiresAt = timeMs(row.expires_at);
  const status = row.status === "pending" && expiresAt <= Date.now() ? "expired" : row.status;
  return {
    deviceCode: row.device_code,
    userCode: row.user_code,
    clientName: row.client_name,
    userId: row.user_id,
    userHandle: row.user_handle,
    status,
    createdAt: timeMs(row.created_at),
    expiresAt,
    approvedAt: row.approved_at ? timeMs(row.approved_at) : null,
    consumedAt: row.consumed_at ? timeMs(row.consumed_at) : null,
  };
}

function rowToOrganization(row: OrganizationRow): OrganizationRecord {
  return {
    id: row.id,
    handle: row.handle,
    displayName: row.display_name,
    description: row.description,
    createdAt: timeMs(row.created_at),
  };
}

function rowToOrganizationMember(row: OrganizationMemberRow): OrganizationMemberRecord {
  return {
    organizationId: row.organization_id,
    organizationHandle: row.organization_handle,
    userId: row.user_id,
    userHandle: row.user_handle,
    role: row.role,
    createdAt: timeMs(row.created_at),
  };
}

function rowToPackageComment(row: PackageCommentRow): PackageCommentRecord {
  return {
    id: row.id,
    packageName: row.package_name,
    userId: row.user_id,
    userHandle: row.user_handle,
    body: row.body,
    reportCount: row.report_count,
    hidden: row.hidden,
    createdAt: timeMs(row.created_at),
    updatedAt: timeMs(row.updated_at),
  };
}

function rowToPackageReport(row: PackageReportRow): PackageReportRecord {
  return {
    id: row.id,
    packageName: row.package_name,
    userId: row.user_id,
    userHandle: row.user_handle,
    reason: row.reason,
    status: row.status,
    resolution: row.resolution,
    resolvedById: row.resolved_by_id,
    resolvedByHandle: row.resolved_by_handle,
    resolvedAt: row.resolved_at ? timeMs(row.resolved_at) : null,
    createdAt: timeMs(row.created_at),
  };
}

function rowToPackage(row: PackageRow, versions: PackageVersionRecord[] = []): PackageRecord {
  const capabilities = row.capabilities;
  return {
    name: row.name,
    displayName: row.display_name,
    family: row.family,
    runtimeId: row.runtime_id,
    channel: row.channel,
    isOfficial: row.is_official,
    summary: row.summary,
    ownerHandle: row.owner_handle,
    topics: row.topics,
    createdAt: timeMs(row.created_at),
    updatedAt: timeMs(row.updated_at),
    latestVersion: row.latest_version,
    capabilityTags: capabilities?.capabilityTags,
    executesCode: capabilities?.executesCode,
    verificationTier: row.verification?.tier ?? null,
    scanStatus: row.verification?.scanStatus ?? null,
    moderationStatus: row.verification?.moderationStatus ?? null,
    deletedAt: row.deleted_at ? timeMs(row.deleted_at) : null,
    tags: row.latest_version ? { latest: row.latest_version } : {},
    compatibility: row.compatibility,
    capabilities,
    verification: row.verification,
    versions,
    stats: normalizeStats(row.stats),
  };
}

function rowToVersion(row: PackageVersionRow, archive: Buffer = Buffer.alloc(0)): PackageVersionRecord {
  return {
    version: row.version,
    createdAt: timeMs(row.created_at),
    yankedAt: row.yanked_at ? timeMs(row.yanked_at) : null,
    yankMessage: row.yank_message,
    changelog: row.changelog,
    distTags: row.dist_tags,
    files: row.files,
    sha256hash: row.sha256hash,
    compatibility: row.compatibility,
    capabilities: row.capabilities,
    verification: row.verification,
    archive,
  };
}

export async function runPostgresMigrations(pool: Pool) {
  const migrationDir = new URL("../../database/migrations/", import.meta.url);
  const migrationFiles = (await readdir(migrationDir))
    .filter((file) => /^\d+_.+\.sql$/.test(file))
    .sort((left, right) => left.localeCompare(right));
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(`
      create table if not exists schema_migrations (
        version text primary key,
        applied_at timestamptz not null default now()
      )
    `);
    for (const file of migrationFiles) {
      const version = file.replace(/\.sql$/, "");
      const applied = await client.query<{ exists: boolean }>(
        "select exists(select 1 from schema_migrations where version = $1) as exists",
        [version],
      );
      if (applied.rows[0]?.exists) continue;
      const migrationSql = await readFile(new URL(file, migrationDir), "utf8");
      await client.query(migrationSql);
      await client.query("insert into schema_migrations (version) values ($1)", [version]);
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export class PostgresRegistryRepository implements RegistryRepository {
  constructor(
    private readonly pool: Pool,
    private readonly archiveStore: ArchiveStore,
  ) {}

  async close() {
    await this.pool.end();
  }

  async createUser(input: { handle: string; email: string; passwordHash: string }) {
    const result = await this.pool.query<UserRow>(
      `
        insert into users (handle, email, password_hash)
        values ($1, $2, $3)
        returning ${userColumns}
      `,
      [normalizeKey(input.handle), normalizeKey(input.email), input.passwordHash],
    );
    const row = result.rows[0];
    if (!row) throw new Error("User creation failed.");
    return rowToUser(row);
  }

  async findOrCreateGitHubUser(input: {
    githubId: string;
    login: string;
    email: string;
    displayName?: string | null;
    imageUrl?: string | null;
  }) {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const existingGithub = await client.query<UserRow>(
        `
          select ${userColumns}
          from users
          where github_id = $1
          limit 1
        `,
        [input.githubId],
      );
      const githubRow = existingGithub.rows[0];
      if (githubRow) {
        await client.query("commit");
        return rowToUser(githubRow);
      }

      const email = normalizeKey(input.email);
      const existingEmail = await client.query<UserRow>(
        `
          select ${userColumns}
          from users
          where email = $1
          limit 1
          for update
        `,
        [email],
      );
      const emailRow = existingEmail.rows[0];
      if (emailRow) {
        if (emailRow.github_id && emailRow.github_id !== input.githubId) {
          throw new Error("Email is already linked to a different GitHub account.");
        }
        const linked = await client.query<UserRow>(
          `
            update users
            set
              github_id = $2,
              display_name = coalesce($3, display_name),
              image_url = coalesce($4, image_url),
              updated_at = now()
            where id = $1
            returning ${userColumns}
          `,
          [emailRow.id, input.githubId, input.displayName ?? null, input.imageUrl ?? null],
        );
        const linkedRow = linked.rows[0];
        if (!linkedRow) throw new Error("GitHub account linking failed.");
        await client.query("commit");
        return rowToUser(linkedRow);
      }

      const handle = await this.createUniqueHandle(client, input.login);
      const inserted = await client.query<UserRow>(
        `
          insert into users (handle, email, password_hash, github_id, display_name, image_url, auth_provider)
          values ($1, $2, $3, $4, $5, $6, 'github')
          returning ${userColumns}
        `,
        [
          handle,
          email,
          `github-oauth:${input.githubId}`,
          input.githubId,
          input.displayName ?? null,
          input.imageUrl ?? null,
        ],
      );
      const row = inserted.rows[0];
      if (!row) throw new Error("GitHub user creation failed.");
      await client.query("commit");
      return rowToUser(row);
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async findUserByEmail(email: string) {
    return this.findUser("email", normalizeKey(email));
  }

  async findUserByHandle(handle: string) {
    return this.findUser("handle", normalizeKey(handle));
  }

  async findUserById(id: string) {
    return this.findUser("id", id);
  }

  async updateUserProfile(userId: string, input: {
    displayName?: string | null;
    imageUrl?: string | null;
    bio?: string | null;
    websiteUrl?: string | null;
    company?: string | null;
    location?: string | null;
  }) {
    const current = await this.findUserById(userId);
    if (!current) throw new Error("User does not exist.");
    const result = await this.pool.query<UserRow>(
      `
        update users
        set
          display_name = $2,
          image_url = $3,
          bio = $4,
          website_url = $5,
          company = $6,
          location = $7,
          updated_at = now()
        where id = $1
        returning ${userColumns}
      `,
      [
        userId,
        "displayName" in input ? input.displayName : current.displayName,
        "imageUrl" in input ? input.imageUrl : current.imageUrl,
        "bio" in input ? input.bio : current.bio,
        "websiteUrl" in input ? input.websiteUrl : current.websiteUrl,
        "company" in input ? input.company : current.company,
        "location" in input ? input.location : current.location,
      ],
    );
    const row = result.rows[0];
    if (!row) throw new Error("User does not exist.");
    return rowToUser(row);
  }

  async createApiToken(input: { userId: string; name: string; tokenHash: string }) {
    const result = await this.pool.query<ApiTokenRow>(
      `
        insert into api_tokens (user_id, name, token_hash)
        values ($1, $2, $3)
        returning id, user_id, name, token_hash, created_at, last_used_at
      `,
      [input.userId, input.name, input.tokenHash],
    );
    const row = result.rows[0];
    if (!row) throw new Error("API token creation failed.");
    return rowToApiToken(row);
  }

  async listApiTokens(userId: string) {
    const result = await this.pool.query<ApiTokenRow>(
      `
        select id, user_id, name, token_hash, created_at, last_used_at
        from api_tokens
        where user_id = $1
        order by created_at desc
      `,
      [userId],
    );
    return result.rows.map(rowToApiToken);
  }

  async revokeApiToken(input: { userId: string; tokenId: string }) {
    const result = await this.pool.query<{ id: string }>(
      "delete from api_tokens where user_id = $1 and id = $2 returning id",
      [input.userId, input.tokenId],
    );
    return result.rowCount === 1;
  }

  async findUserByApiTokenHash(tokenHash: string) {
    const result = await this.pool.query<AuthPrincipal>(
      `
        update api_tokens t
        set last_used_at = now()
        from users u
        where t.user_id = u.id and t.token_hash = $1
        returning u.id, u.handle, u.email
      `,
      [tokenHash],
    );
    return result.rows[0] ?? null;
  }

  async createDeviceAuthorization(input: {
    deviceCode: string;
    userCode: string;
    clientName?: string | null;
    expiresAt: number;
  }) {
    const result = await this.pool.query<DeviceAuthorizationRow>(
      `
        insert into device_authorizations (device_code, user_code, client_name, expires_at)
        values ($1, $2, $3, $4)
        returning
          device_code,
          user_code,
          client_name,
          user_id,
          null::text as user_handle,
          status,
          created_at,
          expires_at,
          approved_at,
          consumed_at
      `,
      [input.deviceCode, input.userCode, input.clientName ?? null, new Date(input.expiresAt)],
    );
    const row = result.rows[0];
    if (!row) throw new Error("Device authorization creation failed.");
    return rowToDeviceAuthorization(row);
  }

  async approveDeviceAuthorization(userCode: string, user: AuthPrincipal) {
    const result = await this.pool.query<DeviceAuthorizationRow>(
      `
        update device_authorizations da
        set
          user_id = $2,
          status = case when expires_at <= now() then 'expired' else 'approved' end,
          approved_at = case when expires_at <= now() then approved_at else now() end
        where da.user_code = $1 and da.status in ('pending', 'approved')
        returning
          da.device_code,
          da.user_code,
          da.client_name,
          da.user_id,
          (select handle from users where id = da.user_id) as user_handle,
          da.status,
          da.created_at,
          da.expires_at,
          da.approved_at,
          da.consumed_at
      `,
      [userCode.trim().toUpperCase(), user.id],
    );
    const row = result.rows[0];
    return row ? rowToDeviceAuthorization(row) : null;
  }

  async getDeviceAuthorization(deviceCode: string) {
    const result = await this.pool.query<DeviceAuthorizationRow>(
      `
        update device_authorizations
        set status = 'expired'
        where device_code = $1 and status = 'pending' and expires_at <= now()
        returning
          device_code,
          user_code,
          client_name,
          user_id,
          (select handle from users where id = user_id) as user_handle,
          status,
          created_at,
          expires_at,
          approved_at,
          consumed_at
      `,
      [deviceCode],
    );
    const expired = result.rows[0];
    if (expired) return rowToDeviceAuthorization(expired);
    const found = await this.pool.query<DeviceAuthorizationRow>(
      `
        select
          da.device_code,
          da.user_code,
          da.client_name,
          da.user_id,
          u.handle as user_handle,
          da.status,
          da.created_at,
          da.expires_at,
          da.approved_at,
          da.consumed_at
        from device_authorizations da
        left join users u on u.id = da.user_id
        where da.device_code = $1
        limit 1
      `,
      [deviceCode],
    );
    const row = found.rows[0];
    return row ? rowToDeviceAuthorization(row) : null;
  }

  async consumeDeviceAuthorization(deviceCode: string) {
    const result = await this.pool.query<DeviceAuthorizationRow>(
      `
        update device_authorizations da
        set status = 'consumed', consumed_at = now()
        where da.device_code = $1 and da.status = 'approved' and da.expires_at > now()
        returning
          da.device_code,
          da.user_code,
          da.client_name,
          da.user_id,
          (select handle from users where id = da.user_id) as user_handle,
          da.status,
          da.created_at,
          da.expires_at,
          da.approved_at,
          da.consumed_at
      `,
      [deviceCode],
    );
    const row = result.rows[0];
    return row ? rowToDeviceAuthorization(row) : this.getDeviceAuthorization(deviceCode);
  }

  async createOrganization(user: AuthPrincipal, input: OrganizationInput) {
    const handle = normalizePublisherHandle(input.handle);
    const userHandle = await this.findUserByHandle(handle);
    if (userHandle) throw new Error("Publisher handle is already taken.");
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const inserted = await client.query<OrganizationRow>(
        `
          insert into organizations (handle, display_name, description)
          values ($1, $2, $3)
          returning id, handle, display_name, description, created_at
        `,
        [handle, input.displayName?.trim() || handle, input.description ?? null],
      );
      const organization = inserted.rows[0];
      if (!organization) throw new Error("Organization creation failed.");
      await client.query(
        `
          insert into organization_members (organization_id, user_id, role)
          values ($1, $2, 'owner')
        `,
        [organization.id, user.id],
      );
      await client.query("commit");
      return rowToOrganization(organization);
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async listUserOrganizations(userId: string) {
    const result = await this.pool.query<OrganizationRow>(
      `
        select o.id, o.handle, o.display_name, o.description, o.created_at
        from organizations o
        join organization_members om on om.organization_id = o.id
        where om.user_id = $1
        order by o.display_name asc
      `,
      [userId],
    );
    return result.rows.map(rowToOrganization);
  }

  async getOrganizationByHandle(handle: string) {
    const result = await this.pool.query<OrganizationRow>(
      `
        select id, handle, display_name, description, created_at
        from organizations
        where handle = $1
        limit 1
      `,
      [normalizePublisherHandle(handle)],
    );
    const row = result.rows[0];
    return row ? rowToOrganization(row) : null;
  }

  async listOrganizationMembers(handle: string) {
    const result = await this.pool.query<OrganizationMemberRow>(
      `
        select
          o.id as organization_id,
          o.handle as organization_handle,
          u.id as user_id,
          u.handle as user_handle,
          om.role,
          om.created_at
        from organization_members om
        join organizations o on o.id = om.organization_id
        join users u on u.id = om.user_id
        where o.handle = $1
        order by case om.role when 'owner' then 0 when 'maintainer' then 1 else 2 end, u.handle asc
      `,
      [normalizePublisherHandle(handle)],
    );
    return result.rows.map(rowToOrganizationMember);
  }

  async addOrganizationMember(handle: string, actor: AuthPrincipal, memberHandle: string, role: OrganizationRole) {
    const organization = await this.getOrganizationByHandle(handle);
    if (!organization) return null;
    if ((await this.organizationRole(organization.id, actor.id)) !== "owner") {
      throw new Error("Only organization owners can manage members.");
    }
    const member = await this.findUserByHandle(memberHandle);
    if (!member) throw new Error("User does not exist.");
    const result = await this.pool.query<OrganizationMemberRow>(
      `
        insert into organization_members (organization_id, user_id, role)
        values ($1, $2, $3)
        on conflict (organization_id, user_id)
        do update set role = excluded.role
        returning
          organization_id,
          (select handle from organizations where id = organization_id) as organization_handle,
          user_id,
          (select handle from users where id = user_id) as user_handle,
          role,
          created_at
      `,
      [organization.id, member.id, role],
    );
    const row = result.rows[0];
    return row ? rowToOrganizationMember(row) : null;
  }

  async listPackages(options: ListPackagesOptions = {}) {
    const limit = clampLimit(options.limit, 50);
    const offset = options.cursor ? Number.parseInt(options.cursor, 10) || 0 : 0;
    const params: unknown[] = [];
    const where: string[] = options.includeDeleted ? [] : ["p.deleted_at is null"];

    if (options.family) where.push(`p.family = ${addParam(params, options.family)}::package_family`);
    if (!options.family && options.families?.length) {
      where.push(`p.family = any(${addParam(params, options.families)}::package_family[])`);
    }
    if (options.owner?.trim()) {
      where.push(`coalesce(p.publisher_handle, u.handle) = ${addParam(params, normalizePublisherHandle(options.owner))}`);
    }
    if (options.tag?.trim()) {
      where.push(`${addParam(params, normalizeTopics([options.tag])[0] ?? "")} = any(p.topics)`);
    }
    if (options.q?.trim() && options.q.trim() !== "*") {
      where.push(packageSearchPredicate(addParam(params, options.q.trim())));
    }

    params.push(limit + 1, offset);
    const result = await this.pool.query<PackageRow>(
      `
        ${packageSelect}
        ${where.length > 0 ? `where ${where.join(" and ")}` : ""}
        ${packageOrderBy(options.sort)}
        limit $${params.length - 1}
        offset $${params.length}
      `,
      params,
    );
    const rows = result.rows.slice(0, limit);
    return {
      items: rows.map((row) => toPackageListItem(rowToPackage(row))),
      nextCursor: result.rows.length > limit ? String(offset + limit) : null,
    };
  }

  async searchPackages(options: SearchPackagesOptions) {
    const limit = clampLimit(options.limit, 20);
    const params: unknown[] = [];
    const where: string[] = ["p.deleted_at is null"];
    let scoreExpression = "1";

    if (options.family) where.push(`p.family = ${addParam(params, options.family)}::package_family`);
    if (!options.family && options.families?.length) {
      where.push(`p.family = any(${addParam(params, options.families)}::package_family[])`);
    }
    if (options.owner?.trim()) {
      where.push(`coalesce(p.publisher_handle, u.handle) = ${addParam(params, normalizePublisherHandle(options.owner))}`);
    }
    if (options.tag?.trim()) {
      where.push(`${addParam(params, normalizeTopics([options.tag])[0] ?? "")} = any(p.topics)`);
    }
    if (options.q.trim() && options.q.trim() !== "*") {
      const qParam = addParam(params, options.q.trim());
      where.push(packageSearchPredicate(qParam));
      scoreExpression = `
        case
          when lower(p.name) = lower(${qParam}) then 100
          when p.name ilike '%' || ${qParam} || '%' then 80
          when p.display_name ilike '%' || ${qParam} || '%' then 60
          when exists(select 1 from unnest(p.topics) topic where lower(topic) = lower(${qParam})) then 50
          when coalesce(p.summary, '') ilike '%' || ${qParam} || '%' then 30
          else 10
        end + ln(1 + ${discoveryScoreExpression()})
      `;
    } else {
      scoreExpression = `1 + ln(1 + ${discoveryScoreExpression()})`;
    }

    params.push(limit);
    const result = await this.pool.query<PackageRow & { score: number }>(
      `
        select
        ${packageColumns},
        ${scoreExpression} as score
        ${packageFrom}
        ${where.length > 0 ? `where ${where.join(" and ")}` : ""}
        order by score desc, p.updated_at desc
        limit $${params.length}
      `,
      params,
    );
    return result.rows.map((row) => ({
      score: Number(row.score),
      package: toPackageListItem(rowToPackage(row)),
    }));
  }

  async getPackage(name: string) {
    const row = await this.getPackageRow(name);
    if (!row) return null;
    const versions = await this.listVersionRows(row.id);
    return rowToPackage(row, versions.map((version) => rowToVersion(version)));
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
    const version = createPackageVersion({ payload: input, compatibility, capabilities });
    const packageName = normalizeKey(input.name);
    const publisher = await this.resolvePublisher(input.ownerHandle, owner);
    const storageKey = archiveStorageKey({
      packageName,
      version: version.version,
      sha256hash: version.sha256hash,
    });
    await this.archiveStore.put(storageKey, version.archive);

    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await this.assertUserExists(client, owner.id);
      const existing = await client.query<{ id: string }>(
        "select id from packages where name = $1 for update",
        [packageName],
      );
      const existingPackage = existing.rows[0];

      if (existingPackage) {
        await this.assertCanManagePackage(client, existingPackage.id, owner.id);
        await this.assertVersionDoesNotExist(client, existingPackage.id, version.version, packageName);
        await client.query("update package_versions set dist_tags = array_remove(dist_tags, 'latest') where package_id = $1", [
          existingPackage.id,
        ]);
        await this.insertVersion(client, existingPackage.id, version, storageKey);
        await client.query(
          `
            update packages
            set
              display_name = coalesce($2, display_name),
              summary = coalesce($3, summary),
              latest_version = $4,
              runtime_id = $5,
              compatibility = $6,
              capabilities = $7,
              verification = $8,
              topics = $9,
              updated_at = $10,
              stats = jsonb_set(
                stats,
                '{versions}',
                to_jsonb((select count(*)::int from package_versions where package_id = $1)),
                true
              )
            where id = $1
          `,
          [
            existingPackage.id,
            input.displayName ?? null,
            input.summary ?? null,
            version.version,
            capabilities?.runtimeId ?? null,
            compatibility,
            capabilities,
            version.verification ?? null,
            topics,
            new Date(version.createdAt),
          ],
        );
      } else {
        const inserted = await client.query<{ id: string }>(
          `
            insert into packages (
              name,
              display_name,
              family,
              channel,
              owner_id,
              summary,
              topics,
              runtime_id,
              latest_version,
              is_official,
              publisher_type,
              publisher_handle,
              compatibility,
              capabilities,
              verification,
              stats,
              created_at,
              updated_at
            )
            values (
              $1,
              $2,
              $3::package_family,
              $4::package_channel,
              $5,
              $6,
              $7,
              $8,
              $9,
              $10,
              $11,
              $12,
              $13,
              $14,
              $15,
              $16,
              $17,
              $17
            )
            returning id
          `,
          [
            packageName,
            input.displayName ?? packageName,
            input.family,
            input.channel,
            owner.id,
            input.summary ?? null,
            topics,
            capabilities?.runtimeId ?? null,
            version.version,
            input.channel === "official",
            publisher.type,
            publisher.type === "organization" ? publisher.handle : null,
            compatibility,
            capabilities,
            version.verification ?? null,
            { downloads: 0, installs: 0, stars: 0, versions: 1 },
            new Date(version.createdAt),
          ],
        );
        const packageId = inserted.rows[0]?.id;
        if (!packageId) throw new Error("Package creation failed.");
        await this.insertVersion(client, packageId, version, storageKey);
      }

      await client.query("commit");
      const pkg = await this.getPackage(packageName);
      if (!pkg) throw new Error("Published package was not found after commit.");
      return pkg;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async updatePackageSettings(name: string, user: AuthPrincipal, input: PackageSettingsInput) {
    const current = await this.getPackage(name);
    if (!current) return null;
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const packageId = await this.packageIdForUpdate(client, name);
      if (!packageId) {
        await client.query("rollback");
        return null;
      }
      await this.assertCanManagePackage(client, packageId, user.id);
      const result = await client.query<{ name: string }>(
        `
          update packages
          set
            display_name = $2,
            summary = $3,
            topics = $4,
            channel = $5::package_channel,
            is_official = $5 = 'official',
            updated_at = now()
          where id = $1
          returning name
        `,
        [
          packageId,
          input.displayName ?? current.displayName,
          input.summary === undefined ? current.summary : input.summary,
          input.tags === undefined ? (current.topics ?? []) : normalizeTopics(input.tags),
          input.channel ?? current.channel,
        ],
      );
      await client.query("commit");
      return this.getPackage(result.rows[0]?.name ?? name);
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async renamePackage(name: string, user: AuthPrincipal, newName: string) {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const packageId = await this.packageIdForUpdate(client, name);
      if (!packageId) {
        await client.query("rollback");
        return null;
      }
      await this.assertCanManagePackage(client, packageId, user.id);
      const result = await client.query<{ name: string }>(
        "update packages set name = $2, updated_at = now() where id = $1 returning name",
        [packageId, normalizeKey(newName)],
      );
      await client.query("commit");
      return this.getPackage(result.rows[0]?.name ?? newName);
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async transferPackage(name: string, user: AuthPrincipal, targetHandle: string) {
    const target = await this.resolveTransferPublisher(targetHandle, user);
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const packageId = await this.packageIdForUpdate(client, name);
      if (!packageId) {
        await client.query("rollback");
        return null;
      }
      await this.assertCanManagePackage(client, packageId, user.id);
      const result = await client.query<{ name: string }>(
        `
          update packages
          set owner_id = $2, publisher_type = $3, publisher_handle = $4, updated_at = now()
          where id = $1
          returning name
        `,
        [packageId, target.ownerId, target.type, target.type === "organization" ? target.handle : null],
      );
      await client.query("commit");
      return this.getPackage(result.rows[0]?.name ?? name);
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async setPackageDeleted(name: string, user: AuthPrincipal, deleted: boolean) {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const packageId = await this.packageIdForUpdate(client, name);
      if (!packageId) {
        await client.query("rollback");
        return null;
      }
      await this.assertCanManagePackage(client, packageId, user.id);
      const result = await client.query<{ name: string }>(
        `
          update packages
          set deleted_at = case when $2 then now() else null end, updated_at = now()
          where id = $1
          returning name
        `,
        [packageId, deleted],
      );
      await client.query("commit");
      return this.getPackage(result.rows[0]?.name ?? name);
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async yankPackageVersion(name: string, version: string, user: AuthPrincipal, message?: string | null) {
    const packageName = normalizeKey(name);
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const pkg = await client.query<{ id: string; latest_version: string | null }>(
        "select id, latest_version from packages where name = $1 for update",
        [packageName],
      );
      const row = pkg.rows[0];
      if (!row) {
        await client.query("rollback");
        return null;
      }
      await this.assertCanManagePackage(client, row.id, user.id);

      const yanked = await client.query<{ version: string }>(
        `
          update package_versions
          set yanked_at = now(), yank_message = $3, dist_tags = array_remove(dist_tags, 'latest')
          where package_id = $1 and version = $2
          returning version
        `,
        [row.id, version, message ?? null],
      );
      if (!yanked.rows[0]) {
        await client.query("rollback");
        return null;
      }

      if (row.latest_version === version) {
        const next = await client.query<{ version: string }>(
          `
            select version
            from package_versions
            where package_id = $1 and yanked_at is null
            order by created_at desc
            limit 1
          `,
          [row.id],
        );
        const nextVersion = next.rows[0]?.version ?? null;
        await client.query("update packages set latest_version = $2, updated_at = now() where id = $1", [
          row.id,
          nextVersion,
        ]);
        if (nextVersion) {
          await client.query(
            `
              update package_versions
              set dist_tags = case when 'latest' = any(dist_tags) then dist_tags else array_append(dist_tags, 'latest') end
              where package_id = $1 and version = $2
            `,
            [row.id, nextVersion],
          );
        }
      } else {
        await client.query("update packages set updated_at = now() where id = $1", [row.id]);
      }

      await client.query("commit");
      return this.getPackage(packageName);
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async getArchive(name: string, selector: { version?: string; tag?: string } = {}) {
    const pkgRow = await this.getPackageRow(name);
    if (!pkgRow || pkgRow.deleted_at) return null;

    const versionRow = await this.getArchiveVersionRow(pkgRow.id, selector, pkgRow.latest_version);
    if (!versionRow) return null;

    const archive = await this.archiveStore.get(versionRow.archive_storage_key);
    if (!archive) return null;

    const version = rowToVersion(versionRow, archive);
    return { pkg: rowToPackage(pkgRow, [version]), version };
  }

  async recordDownload(name: string) {
    await this.incrementStat(name, "downloads");
  }

  async recordInstall(name: string) {
    await this.incrementStat(name, "installs");
  }

  async recordStar(name: string) {
    await this.incrementStat(name, "stars");
  }

  async getPackageStar(name: string, userId: string) {
    const result = await this.pool.query<{ exists: boolean }>(
      `
        select exists(
          select 1
          from package_stars ps
          join packages p on p.id = ps.package_id
          where p.name = $1 and ps.user_id = $2
        ) as exists
      `,
      [normalizeKey(name), userId],
    );
    return Boolean(result.rows[0]?.exists);
  }

  async togglePackageStar(name: string, user: AuthPrincipal) {
    const packageName = normalizeKey(name);
    const client = await this.pool.connect();
    let starred = false;
    try {
      await client.query("begin");
      const packageResult = await client.query<{ id: string }>(
        "select id from packages where name = $1 for update",
        [packageName],
      );
      const packageId = packageResult.rows[0]?.id;
      if (!packageId) {
        await client.query("rollback");
        return null;
      }

      const existing = await client.query<{ package_id: string }>(
        "select package_id from package_stars where package_id = $1 and user_id = $2",
        [packageId, user.id],
      );

      if (existing.rows[0]) {
        await client.query("delete from package_stars where package_id = $1 and user_id = $2", [
          packageId,
          user.id,
        ]);
        await client.query(
          `
            update packages
            set stats = jsonb_set(stats, '{stars}', to_jsonb(greatest(coalesce((stats->>'stars')::int, 0) - 1, 0)), true)
            where id = $1
          `,
          [packageId],
        );
        starred = false;
      } else {
        await client.query("insert into package_stars (package_id, user_id) values ($1, $2)", [
          packageId,
          user.id,
        ]);
        await client.query(
          `
            update packages
            set stats = jsonb_set(stats, '{stars}', to_jsonb(coalesce((stats->>'stars')::int, 0) + 1), true)
            where id = $1
          `,
          [packageId],
        );
        starred = true;
      }

      await client.query("commit");
      const pkg = await this.getPackage(packageName);
      return pkg ? { pkg, starred } : null;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async listStarredPackages(userId: string, options: { limit?: number; cursor?: string } = {}) {
    const limit = clampLimit(options.limit, 50);
    const offset = options.cursor ? Number.parseInt(options.cursor, 10) || 0 : 0;
    const result = await this.pool.query<PackageRow>(
      `
        select
          ${packageColumns}
        from packages p
        join users u on u.id = p.owner_id
        join package_stars ps on ps.package_id = p.id
        where ps.user_id = $1 and p.deleted_at is null
        order by ps.created_at desc
        limit $2
        offset $3
      `,
      [userId, limit + 1, offset],
    );
    const rows = result.rows.slice(0, limit);
    return {
      items: rows.map((row) => toPackageListItem(rowToPackage(row))),
      nextCursor: result.rows.length > limit ? String(offset + limit) : null,
    };
  }

  async listPackageComments(name: string, options: { limit?: number; cursor?: string } = {}) {
    const limit = clampLimit(options.limit, 50);
    const offset = options.cursor ? Number.parseInt(options.cursor, 10) || 0 : 0;
    const result = await this.pool.query<PackageCommentRow>(
      `
        select
          pc.id,
          p.name as package_name,
          pc.user_id,
          u.handle as user_handle,
          pc.body,
          pc.report_count,
          pc.hidden,
          pc.created_at,
          pc.updated_at
        from package_comments pc
        join packages p on p.id = pc.package_id
        join users u on u.id = pc.user_id
        where p.name = $1 and pc.hidden = false
        order by pc.created_at asc
        limit $2
        offset $3
      `,
      [normalizeKey(name), limit + 1, offset],
    );
    const rows = result.rows.slice(0, limit);
    return {
      items: rows.map(rowToPackageComment),
      nextCursor: result.rows.length > limit ? String(offset + limit) : null,
    };
  }

  async addPackageComment(name: string, user: AuthPrincipal, body: string) {
    const result = await this.pool.query<PackageCommentRow>(
      `
        insert into package_comments (package_id, user_id, body)
        select p.id, $2, $3
        from packages p
        where p.name = $1
        returning
          id,
          (select name from packages where id = package_id) as package_name,
          user_id,
          (select handle from users where id = user_id) as user_handle,
          body,
          report_count,
          hidden,
          created_at,
          updated_at
      `,
      [normalizeKey(name), user.id, body],
    );
    const row = result.rows[0];
    return row ? rowToPackageComment(row) : null;
  }

  async reportPackage(name: string, user: AuthPrincipal, reason: string) {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const report = await client.query<PackageReportRow>(
        `
          insert into package_reports (package_id, user_id, reason)
          select p.id, $2, $3
          from packages p
          where p.name = $1
          returning
            id,
            (select name from packages where id = package_id) as package_name,
            user_id,
            (select handle from users where id = user_id) as user_handle,
            reason,
            status,
            resolution,
            resolved_by_id,
            null::text as resolved_by_handle,
            resolved_at,
            created_at
        `,
        [normalizeKey(name), user.id, reason],
      );
      const row = report.rows[0];
      if (!row) {
        await client.query("rollback");
        return null;
      }

      await client.query(
        `
          update packages
          set verification = coalesce(verification, '{}'::jsonb)
            || jsonb_build_object(
              'tier', coalesce(verification->>'tier', 'structural'),
              'scope', coalesce(verification->>'scope', 'artifact-only'),
              'moderationStatus', case when verification->>'moderationStatus' = 'approved' then 'pending' else coalesce(verification->>'moderationStatus', 'pending') end,
              'summary', 'A community report is queued for moderation review.'
            )
          where name = $1
        `,
        [normalizeKey(name)],
      );
      await client.query("commit");
      return rowToPackageReport(row);
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async listPackageReports(options: ListPackageReportsOptions = {}) {
    const limit = clampLimit(options.limit, 50);
    const offset = options.cursor ? Number.parseInt(options.cursor, 10) || 0 : 0;
    const params: unknown[] = [];
    const where: string[] = [];
    if (options.status) where.push(`pr.status = ${addParam(params, options.status)}`);
    params.push(limit + 1, offset);
    const result = await this.pool.query<PackageReportRow>(
      `
        select
          pr.id,
          p.name as package_name,
          pr.user_id,
          u.handle as user_handle,
          pr.reason,
          pr.status,
          pr.resolution,
          pr.resolved_by_id,
          ru.handle as resolved_by_handle,
          pr.resolved_at,
          pr.created_at
        from package_reports pr
        join packages p on p.id = pr.package_id
        join users u on u.id = pr.user_id
        left join users ru on ru.id = pr.resolved_by_id
        ${where.length > 0 ? `where ${where.join(" and ")}` : ""}
        order by pr.created_at desc
        limit $${params.length - 1}
        offset $${params.length}
      `,
      params,
    );
    const rows = result.rows.slice(0, limit);
    return {
      items: rows.map(rowToPackageReport),
      nextCursor: result.rows.length > limit ? String(offset + limit) : null,
    };
  }

  async updatePackageReport(reportId: string, reviewer: AuthPrincipal, input: PackageReportUpdateInput) {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const updated = await client.query<PackageReportRow>(
        `
          update package_reports pr
          set
            status = $2,
            resolution = $3,
            resolved_by_id = case when $2 = 'open' then null else $4 end,
            resolved_at = case when $2 = 'open' then null else now() end
          from packages p, users u
          where pr.id = $1 and p.id = pr.package_id and u.id = pr.user_id
          returning
            pr.id,
            p.name as package_name,
            pr.user_id,
            u.handle as user_handle,
            pr.reason,
            pr.status,
            pr.resolution,
            pr.resolved_by_id,
            (select handle from users where id = pr.resolved_by_id) as resolved_by_handle,
            pr.resolved_at,
            pr.created_at
        `,
        [reportId, input.status, input.resolution ?? null, reviewer.id],
      );
      const row = updated.rows[0];
      if (!row) {
        await client.query("rollback");
        return null;
      }

      if (input.moderationStatus) {
        const pkg = await this.getPackage(row.package_name);
        if (pkg) {
          const verification = mergeVerification(pkg.verification, {
            moderationStatus: input.moderationStatus,
            summary: input.resolution ?? pkg.verification?.summary ?? null,
          });
          await client.query("update packages set verification = $2, updated_at = now() where name = $1", [
            normalizeKey(row.package_name),
            verification,
          ]);
        }
      }

      await client.query("commit");
      return rowToPackageReport(row);
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async updatePackageModeration(name: string, _reviewer: AuthPrincipal, input: PackageModerationInput) {
    const current = await this.getPackage(name);
    if (!current) return null;
    const verification = mergeVerification(current.verification, input);
    const result = await this.pool.query<{ name: string }>(
      `
        update packages
        set verification = $2, updated_at = now()
        where name = $1
        returning name
      `,
      [normalizeKey(name), verification],
    );
    const row = result.rows[0];
    return row ? this.getPackage(row.name) : null;
  }

  private async organizationRole(organizationId: string, userId: string) {
    const result = await this.pool.query<{ role: OrganizationRole }>(
      "select role from organization_members where organization_id = $1 and user_id = $2 limit 1",
      [organizationId, userId],
    );
    return result.rows[0]?.role ?? null;
  }

  private async resolvePublisher(handle: string | undefined, user: AuthPrincipal) {
    const requested = handle?.trim() ? normalizePublisherHandle(handle) : user.handle;
    if (normalizeKey(requested) === normalizeKey(user.handle)) {
      return { type: "user" as const, handle: user.handle, ownerId: user.id };
    }
    const organization = await this.getOrganizationByHandle(requested);
    const role = organization ? await this.organizationRole(organization.id, user.id) : null;
    if (!organization || (role !== "owner" && role !== "maintainer")) {
      throw new Error("You can only publish as yourself or an organization you maintain.");
    }
    return { type: "organization" as const, handle: organization.handle, ownerId: user.id };
  }

  private async resolveTransferPublisher(handle: string, actor: AuthPrincipal) {
    const targetUser = await this.findUserByHandle(handle);
    if (targetUser) return { type: "user" as const, handle: targetUser.handle, ownerId: targetUser.id };
    return this.resolvePublisher(handle, actor);
  }

  private async packageIdForUpdate(client: PoolClient, name: string) {
    const result = await client.query<{ id: string }>(
      "select id from packages where name = $1 for update",
      [normalizeKey(name)],
    );
    return result.rows[0]?.id ?? null;
  }

  private async assertCanManagePackage(client: PoolClient, packageId: string, userId: string) {
    const result = await client.query<{
      owner_id: string;
      publisher_type: "user" | "organization";
      organization_id: string | null;
      role: OrganizationRole | null;
    }>(
      `
        select
          p.owner_id,
          coalesce(p.publisher_type, 'user') as publisher_type,
          o.id as organization_id,
          om.role
        from packages p
        left join organizations o on o.handle = p.publisher_handle
        left join organization_members om on om.organization_id = o.id and om.user_id = $2
        where p.id = $1
        limit 1
      `,
      [packageId, userId],
    );
    const row = result.rows[0];
    if (!row) throw new Error("Package does not exist.");
    if (row.publisher_type === "organization") {
      if (row.role === "owner" || row.role === "maintainer") return;
      throw new Error("Only organization owners and maintainers can manage this package.");
    }
    if (row.owner_id === userId) return;
    throw new Error("Only the package owner can manage this package.");
  }

  private async incrementStat(name: string, field: "downloads" | "installs" | "stars") {
    await this.pool.query(
      `
        update packages
        set stats = jsonb_set(
          stats,
          $2::text[],
          to_jsonb(coalesce((stats->>$3)::int, 0) + 1),
          true
        )
        where name = $1
      `,
      [normalizeKey(name), [field], field],
    );
  }

  private async findUser(field: "id" | "email" | "handle", value: string) {
    const result = await this.pool.query<UserRow>(
      `
        select ${userColumns}
        from users
        where ${field} = $1
        limit 1
      `,
      [value],
    );
    const row = result.rows[0];
    return row ? rowToUser(row) : null;
  }

  private async createUniqueHandle(client: PoolClient, login: string) {
    const base =
      login
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .replace(/-{2,}/g, "-") || "github-user";
    let handle = base;
    for (let index = 2; index < 1000; index += 1) {
      const result = await client.query<{ exists: boolean }>(
        "select exists(select 1 from users where handle = $1) as exists",
        [handle],
      );
      if (!result.rows[0]?.exists) return handle;
      handle = `${base}-${index}`;
    }
    throw new Error("Could not allocate a unique GitHub handle.");
  }

  private async getPackageRow(name: string) {
    const result = await this.pool.query<PackageRow>(
      `
        ${packageSelect}
        where p.name = $1
        limit 1
      `,
      [normalizeKey(name)],
    );
    return result.rows[0] ?? null;
  }

  private async listVersionRows(packageId: string) {
    const result = await this.pool.query<PackageVersionRow>(
      `
        select
          pv.id,
          pv.version,
          pv.changelog,
          pv.archive_storage_key,
          pv.sha256hash,
          pv.dist_tags,
          pv.compatibility,
          pv.capabilities,
          pv.verification,
          pv.yanked_at,
          pv.yank_message,
          pv.created_at,
          coalesce(
            jsonb_agg(
              jsonb_build_object(
                'path', pf.path,
                'size', pf.size_bytes,
                'sha256', pf.sha256,
                'contentType', pf.content_type
              )
              order by pf.path
            ) filter (where pf.id is not null),
            '[]'::jsonb
          ) as files
        from package_versions pv
        left join package_files pf on pf.package_version_id = pv.id
        where pv.package_id = $1
        group by pv.id
        order by pv.created_at desc
      `,
      [packageId],
    );
    return result.rows;
  }

  private async getArchiveVersionRow(packageId: string, selector: { version?: string; tag?: string }, latestVersion: string | null) {
    const params: unknown[] = [packageId];
    const where = ["pv.package_id = $1"];
    if (selector.version) {
      where.push(`pv.version = ${addParam(params, selector.version)}`);
    } else if (selector.tag) {
      where.push(`${addParam(params, selector.tag)} = any(pv.dist_tags)`);
    } else if (latestVersion) {
      where.push(`pv.version = ${addParam(params, latestVersion)}`);
    }

    const result = await this.pool.query<PackageVersionRow>(
      `
        select
          pv.id,
          pv.version,
          pv.changelog,
          pv.archive_storage_key,
          pv.sha256hash,
          pv.dist_tags,
          pv.compatibility,
          pv.capabilities,
          pv.verification,
          pv.yanked_at,
          pv.yank_message,
          pv.created_at,
          coalesce(
            jsonb_agg(
              jsonb_build_object(
                'path', pf.path,
                'size', pf.size_bytes,
                'sha256', pf.sha256,
                'contentType', pf.content_type
              )
              order by pf.path
            ) filter (where pf.id is not null),
            '[]'::jsonb
          ) as files
        from package_versions pv
        left join package_files pf on pf.package_version_id = pv.id
        where ${where.join(" and ")} and pv.yanked_at is null
        group by pv.id
        order by pv.created_at desc
        limit 1
      `,
      params,
    );
    return result.rows[0] ?? null;
  }

  private async assertUserExists(client: PoolClient, userId: string) {
    const result = await client.query<{ exists: boolean }>(
      "select exists(select 1 from users where id = $1) as exists",
      [userId],
    );
    if (!result.rows[0]?.exists) throw new Error("Publishing user does not exist.");
  }

  private async assertVersionDoesNotExist(client: PoolClient, packageId: string, version: string, packageName: string) {
    const result = await client.query<{ exists: boolean }>(
      "select exists(select 1 from package_versions where package_id = $1 and version = $2) as exists",
      [packageId, version],
    );
    if (result.rows[0]?.exists) throw new Error(`Version ${version} already exists for ${packageName}.`);
  }

  private async insertVersion(
    client: PoolClient,
    packageId: string,
    version: PackageVersionRecord,
    archiveStorageKey: string,
  ) {
    const inserted = await client.query<{ id: string }>(
      `
        insert into package_versions (
          package_id,
          version,
          changelog,
          archive_storage_key,
          sha256hash,
          dist_tags,
          compatibility,
          capabilities,
          verification,
          created_at
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        returning id
      `,
      [
        packageId,
        version.version,
        version.changelog,
        archiveStorageKey,
        version.sha256hash,
        version.distTags,
        version.compatibility ?? null,
        version.capabilities ?? null,
        version.verification ?? null,
        new Date(version.createdAt),
      ],
    );
    const versionId = inserted.rows[0]?.id;
    if (!versionId) throw new Error("Package version creation failed.");

    for (const file of version.files) {
      await client.query(
        `
          insert into package_files (package_version_id, path, size_bytes, sha256, content_type)
          values ($1, $2, $3, $4, $5)
        `,
        [versionId, file.path, file.size, file.sha256, file.contentType ?? null],
      );
    }
  }
}

export async function createPostgresRegistryRepository() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required for Postgres repository mode.");

  const pool = new Pool({ connectionString });
  try {
    await runPostgresMigrations(pool);
  } catch (error) {
    await pool.end();
    throw error;
  }

  const repo = new PostgresRegistryRepository(pool, createArchiveStoreFromEnv());
  return repo;
}
