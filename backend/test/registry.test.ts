import { createHash } from "node:crypto";
import { strToU8, unzipSync, zipSync } from "fflate";
import { describe, expect, it, vi } from "vitest";
import { InMemoryRegistryRepository } from "../src/repository.js";
import { buildServer } from "../src/server.js";
import { buildServerWithPackageFixtures } from "./fixtures.js";

const multipartBoundary = "----kovahub-test-boundary";

async function signInWithGitHub(app: Awaited<ReturnType<typeof buildServer>>) {
  const previousClientId = process.env.GITHUB_CLIENT_ID;
  const previousClientSecret = process.env.GITHUB_CLIENT_SECRET;
  const previousSite = process.env.KOVAHUB_SITE;
  const previousRegistry = process.env.KOVAHUB_REGISTRY;
  const originalFetch = globalThis.fetch;

  process.env.GITHUB_CLIENT_ID = "test-github-client";
  process.env.GITHUB_CLIENT_SECRET = "test-github-secret";
  process.env.KOVAHUB_SITE = "http://localhost:5173";
  process.env.KOVAHUB_REGISTRY = "http://localhost:8787";

  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url === "https://github.com/login/oauth/access_token") {
      return new Response(JSON.stringify({ access_token: "gho_test" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url === "https://api.github.com/user") {
      return new Response(
        JSON.stringify({
          id: 10_000,
          login: "tester",
          name: "Tester",
          avatar_url: "https://avatars.example/tester.png",
          email: null,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (url === "https://api.github.com/user/emails") {
      return new Response(
        JSON.stringify([{ email: "tester@example.com", primary: true, verified: true }]),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    throw new Error(`Unexpected GitHub fetch: ${url}`);
  }) as typeof fetch;

  try {
    const start = await app.inject("/api/v1/auth/github/start?returnTo=%2Fpublish");
    expect(start.statusCode).toBe(302);
    const authorize = new URL(start.headers.location as string);
    const state = authorize.searchParams.get("state");
    expect(state).toEqual(expect.any(String));
    const setCookie = start.headers["set-cookie"];
    const stateCookie = Array.isArray(setCookie) ? setCookie[0] : String(setCookie);
    const cookieHeader = stateCookie.split(";")[0];

    const callback = await app.inject({
      method: "GET",
      url: `/api/v1/auth/github/callback?code=oauth-code&state=${state}`,
      headers: { cookie: cookieHeader },
    });
    expect(callback.statusCode).toBe(302);
    const frontendCallback = new URL(callback.headers.location as string);
    const token = new URLSearchParams(frontendCallback.hash.slice(1)).get("token");
    expect(token).toEqual(expect.any(String));
    return token as string;
  } finally {
    globalThis.fetch = originalFetch;
    if (previousClientId === undefined) delete process.env.GITHUB_CLIENT_ID;
    else process.env.GITHUB_CLIENT_ID = previousClientId;
    if (previousClientSecret === undefined) delete process.env.GITHUB_CLIENT_SECRET;
    else process.env.GITHUB_CLIENT_SECRET = previousClientSecret;
    if (previousSite === undefined) delete process.env.KOVAHUB_SITE;
    else process.env.KOVAHUB_SITE = previousSite;
    if (previousRegistry === undefined) delete process.env.KOVAHUB_REGISTRY;
    else process.env.KOVAHUB_REGISTRY = previousRegistry;
  }
}

async function createApiToken(app: Awaited<ReturnType<typeof buildServer>>, jwt: string) {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/auth/tokens",
    headers: { authorization: `Bearer ${jwt}` },
    payload: { name: "local cli" },
  });
  expect(response.statusCode).toBe(201);
  const body = response.json<{ token: string; apiToken: { id: string; name: string; lastUsedAt: number | null } }>();
  expect(body.token).toMatch(/^khp_/);
  expect(body.apiToken.name).toBe("local cli");
  expect(body.apiToken.lastUsedAt).toBeNull();
  return body;
}

function sha256Hex(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}

function buildMultipartArchivePayload(params: {
  archive: Buffer;
  metadata?: Record<string, unknown>;
}) {
  const chunks: Buffer[] = [];
  const push = (value: string | Buffer) => chunks.push(Buffer.isBuffer(value) ? value : Buffer.from(value));
  if (params.metadata) {
    push(`--${multipartBoundary}\r\n`);
    push('content-disposition: form-data; name="metadata"\r\n');
    push("content-type: application/json\r\n\r\n");
    push(JSON.stringify(params.metadata));
    push("\r\n");
  }
  push(`--${multipartBoundary}\r\n`);
  push('content-disposition: form-data; name="archive"; filename="archive.zip"\r\n');
  push("content-type: application/zip\r\n\r\n");
  push(params.archive);
  push("\r\n");
  push(`--${multipartBoundary}--\r\n`);
  return {
    headers: {
      "content-type": `multipart/form-data; boundary=${multipartBoundary}`,
    },
    payload: Buffer.concat(chunks),
  };
}

function buildKovaPluginArchive() {
  return Buffer.from(
    zipSync({
      "package.json": strToU8(
        JSON.stringify(
          {
            name: "@tester/archive-plugin",
            version: "0.2.0",
            description: "Published from a Kova plugin archive.",
            type: "module",
            kova: {
              compat: {
                pluginApi: "^1.0.0",
                minGatewayVersion: "2026.4.0",
              },
              build: {
                kovaVersion: "2026.4.1",
                pluginSdkVersion: "1.0.0",
              },
              extensions: ["./index.js"],
            },
          },
          null,
          2,
        ),
      ),
      "index.js": strToU8("export default {};\n"),
      "README.md": strToU8("# Archive Plugin\n"),
    }),
  );
}

describe("registry api", () => {
  it("advertises Kova registry environment targets", async () => {
    const previousRegistry = process.env.KOVAHUB_REGISTRY;
    const previousSite = process.env.KOVAHUB_SITE;
    process.env.KOVAHUB_REGISTRY = "https://registry.kova.example";
    process.env.KOVAHUB_SITE = "https://hub.kova.example";
    const app = await buildServer();
    try {
      const meta = await app.inject("/api/v1/meta");
      expect(meta.statusCode).toBe(200);
      const body = meta.json();
      expect(body).toMatchObject({
        name: "KovaHub",
        registry: "https://registry.kova.example",
        site: "https://hub.kova.example",
      });
      expect(body.compatibility.env).toEqual(
        expect.arrayContaining(["KOVA_KOVAHUB_URL", "KOVAHUB_URL", "KOVAHUB_REGISTRY", "KOVAHUB_SITE"]),
      );
    } finally {
      if (previousRegistry === undefined) {
        delete process.env.KOVAHUB_REGISTRY;
      } else {
        process.env.KOVAHUB_REGISTRY = previousRegistry;
      }
      if (previousSite === undefined) {
        delete process.env.KOVAHUB_SITE;
      } else {
        process.env.KOVAHUB_SITE = previousSite;
      }
      await app.close();
    }
  });

  it("serves KovaHub registry discovery", async () => {
    const previousRegistry = process.env.KOVAHUB_REGISTRY;
    const previousSite = process.env.KOVAHUB_SITE;
    process.env.KOVAHUB_REGISTRY = "https://registry.kova.example/";
    process.env.KOVAHUB_SITE = "https://hub.kova.example/";
    const app = await buildServer();
    try {
      const discovery = await app.inject("/.well-known/kovahub.json");
      expect(discovery.statusCode).toBe(200);
      expect(discovery.json()).toMatchObject({
        name: "KovaHub",
        apiBase: "https://registry.kova.example",
        authBase: "https://registry.kova.example",
        siteBase: "https://hub.kova.example",
        minCliVersion: "0.0.1",
        env: {
          registry: "KOVAHUB_REGISTRY",
          site: "KOVAHUB_SITE",
        },
      });
    } finally {
      if (previousRegistry === undefined) {
        delete process.env.KOVAHUB_REGISTRY;
      } else {
        process.env.KOVAHUB_REGISTRY = previousRegistry;
      }
      if (previousSite === undefined) {
        delete process.env.KOVAHUB_SITE;
      } else {
        process.env.KOVAHUB_SITE = previousSite;
      }
      await app.close();
    }
  });

  it("starts without sample packages", async () => {
    const app = await buildServer();
    try {
      const packages = await app.inject("/api/v1/packages");
      expect(packages.statusCode).toBe(200);
      expect(packages.json()).toMatchObject({ items: [], nextCursor: null });

      const search = await app.inject("/api/v1/packages/search?q=context");
      expect(search.statusCode).toBe(200);
      expect(search.json()).toEqual({ results: [] });
    } finally {
      await app.close();
    }
  });

  it("serves API docs, search suggestions, and security headers", async () => {
    const app = await buildServerWithPackageFixtures();
    try {
      const health = await app.inject("/healthz");
      expect(health.statusCode).toBe(200);
      expect(health.headers["x-content-type-options"]).toBe("nosniff");
      expect(health.headers["x-frame-options"]).toBe("DENY");

      const docs = await app.inject("/openapi.json");
      expect(docs.statusCode).toBe(200);
      expect(docs.json()).toMatchObject({
        openapi: "3.1.0",
        info: { title: "KovaHub Registry API" },
        paths: {
          "/api/v1/packages": expect.any(Object),
          "/api/v1/search/suggestions": expect.any(Object),
        },
      });

      const suggestions = await app.inject("/api/v1/search/suggestions?q=context");
      expect(suggestions.statusCode).toBe(200);
      expect(suggestions.json()).toMatchObject({
        packages: [
          expect.objectContaining({
            name: "@openkova/context-bridge",
            ownerHandle: "openkova",
          }),
        ],
        tags: expect.arrayContaining([expect.objectContaining({ tag: "context", count: 1 })]),
        publishers: expect.arrayContaining([expect.objectContaining({ handle: "openkova", count: 1 })]),
      });
    } finally {
      await app.close();
    }
  });

  it("serves KovaHub-compatible package search and detail responses", async () => {
    const app = await buildServerWithPackageFixtures();
    const search = await app.inject("/api/v1/packages/search?q=context");
    expect(search.statusCode).toBe(200);
    const body = search.json<{ results: Array<{ package: { name: string } }> }>();
    expect(body.results[0]?.package.name).toBe("@openkova/context-bridge");

    const plugins = await app.inject("/api/v1/plugins?limit=10");
    expect(plugins.statusCode).toBe(200);
    expect(plugins.json().items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "@openkova/context-bridge",
          family: "code-plugin",
        }),
      ]),
    );

    const pluginSearch = await app.inject("/api/v1/plugins/search?q=context");
    expect(pluginSearch.statusCode).toBe(200);
    expect(pluginSearch.json().results[0].package.family).toBe("code-plugin");

    const codePlugins = await app.inject("/api/v1/code-plugins?limit=10");
    expect(codePlugins.statusCode).toBe(200);
    expect(codePlugins.json().items.every((item: { family: string }) => item.family === "code-plugin")).toBe(true);

    const detail = await app.inject("/api/v1/packages/%40openkova%2Fcontext-bridge");
    expect(detail.statusCode).toBe(200);
    expect(detail.json().package.compatibility.pluginApiRange).toBe("^1.0.0");
    expect(detail.json().package.topics).toEqual(["context", "gateway"]);
    expect(detail.json().package.verification).toMatchObject({
      scanStatus: "clean",
      moderationStatus: "approved",
    });
    expect(detail.json().package.versions[0].documentation).toMatchObject({
      readmePath: "README.md",
      readmeMarkdown: expect.stringContaining("Context Bridge"),
    });

    const topicList = await app.inject("/api/v1/packages?tag=context");
    expect(topicList.statusCode).toBe(200);
    expect(topicList.json().items.map((item: { name: string }) => item.name)).toContain("@openkova/context-bridge");
    expect(topicList.json().items[0].stats).toMatchObject({
      downloads: expect.any(Number),
      installs: expect.any(Number),
      stars: expect.any(Number),
    });

    const installSignal = await app.inject({
      method: "POST",
      url: "/api/v1/packages/%40openkova%2Fcontext-bridge/install",
    });
    expect(installSignal.statusCode).toBe(200);
    expect(installSignal.json().stats.installs).toBe(1);

    const starSignal = await app.inject({
      method: "POST",
      url: "/api/v1/packages/%40openkova%2Fcontext-bridge/star",
    });
    expect(starSignal.statusCode).toBe(200);
    expect(starSignal.json().stats.stars).toBe(1);

    const trending = await app.inject("/api/v1/packages/trending");
    expect(trending.statusCode).toBe(200);
    expect(trending.json().items[0]).toMatchObject({
      name: "@openkova/context-bridge",
      stats: expect.objectContaining({ installs: 1, stars: 1 }),
    });

    const topicRoute = await app.inject("/api/v1/tags/gateway/packages");
    expect(topicRoute.statusCode).toBe(200);
    expect(topicRoute.json().items.map((item: { name: string }) => item.name)).toContain("@openkova/context-bridge");

    const publisherRoute = await app.inject("/api/v1/publishers/openkova/packages");
    expect(publisherRoute.statusCode).toBe(200);
    expect(publisherRoute.json().items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ownerHandle: "openkova",
        }),
      ]),
    );

    const publisherProfile = await app.inject("/api/v1/profiles/openkova");
    expect(publisherProfile.statusCode).toBe(200);
    expect(publisherProfile.json().profile).toMatchObject({
      handle: "openkova",
      displayName: "OpenKova",
      stats: expect.objectContaining({
        packages: expect.any(Number),
        plugins: expect.any(Number),
        skills: expect.any(Number),
      }),
    });

    const versions = await app.inject("/api/v1/packages/%40openkova%2Fcontext-bridge/versions");
    expect(versions.statusCode).toBe(200);
    expect(versions.json().items[0]).toMatchObject({
      version: "0.1.0",
      distTags: ["latest"],
    });
    await app.close();
  });

  it("serves the Kova skill discovery and install contract", async () => {
    const app = await buildServerWithPackageFixtures();

    const search = await app.inject("/api/v1/search?q=release&limit=5");
    expect(search.statusCode).toBe(200);
    expect(search.json().results[0]).toMatchObject({
      slug: "release-notes-sherpa",
      displayName: "Release Notes Sherpa",
      version: "1.0.0",
    });

    const list = await app.inject("/api/v1/skills?limit=5");
    expect(list.statusCode).toBe(200);
    expect(list.json().items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          slug: "release-notes-sherpa",
          latestVersion: expect.objectContaining({ version: "1.0.0" }),
        }),
      ]),
    );

    const detail = await app.inject("/api/v1/skills/release-notes-sherpa");
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({
      skill: {
        slug: "release-notes-sherpa",
        displayName: "Release Notes Sherpa",
      },
      latestVersion: {
        version: "1.0.0",
      },
    });

    const versions = await app.inject("/api/v1/skills/release-notes-sherpa/versions");
    expect(versions.statusCode).toBe(200);
    expect(versions.json().items[0]).toMatchObject({
      version: "1.0.0",
      distTags: ["latest"],
    });

    const download = await app.inject("/api/v1/download?slug=release-notes-sherpa&version=1.0.0");
    expect(download.statusCode).toBe(200);
    expect(download.headers["content-type"]).toContain("application/zip");
    const files = unzipSync(new Uint8Array(download.rawPayload));
    expect(Object.keys(files)).toContain("SKILL.md");
    await app.close();
  });

  it("publishes a plugin package with latest tag and downloadable archive", async () => {
    const app = await buildServer();
    const token = await signInWithGitHub(app);

    const publish = await app.inject({
      method: "POST",
      url: "/api/v1/packages",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: "@tester/demo-plugin",
        displayName: "Demo Plugin",
        family: "code-plugin",
        version: "0.1.0",
        summary: "Demo plugin",
        compatibility: {
          pluginApi: "^1.0.0",
          minGatewayVersion: "2026.3.0",
        },
        tags: ["demo", "gateway"],
        files: [
          {
            path: "package.json",
            content: "{\"name\":\"@tester/demo-plugin\",\"version\":\"0.1.0\"}\n",
            contentType: "application/json",
          },
          {
            path: "README.md",
            content: "# Demo Plugin\n\nDemo plugin docs.\n",
            contentType: "text/markdown",
          },
        ],
      },
    });
    expect(publish.statusCode).toBe(201);
    expect(publish.json().package.latestVersion).toBe("0.1.0");
    expect(publish.json().package.topics).toEqual(["demo", "gateway"]);
    expect(publish.json().package).toMatchObject({
      scanStatus: "clean",
      moderationStatus: "pending",
      verification: {
        scanStatus: "clean",
        moderationStatus: "pending",
        riskLevel: "medium",
      },
    });

    const version = await app.inject("/api/v1/packages/%40tester%2Fdemo-plugin/versions/0.1.0");
    expect(version.statusCode).toBe(200);
    expect(version.json().version.distTags).toContain("latest");
    expect(version.json().version.documentation).toMatchObject({
      readmePath: "README.md",
      readmeMarkdown: expect.stringContaining("Demo Plugin"),
    });
    expect(version.json().version.verification).toMatchObject({
      scanStatus: "clean",
      moderationStatus: "pending",
    });

    const download = await app.inject("/api/v1/packages/%40tester%2Fdemo-plugin/download?tag=latest");
    expect(download.statusCode).toBe(200);
    expect(download.headers["content-type"]).toContain("application/zip");
    expect(download.rawPayload.byteLength).toBeGreaterThan(20);

    const detail = await app.inject("/api/v1/packages/%40tester%2Fdemo-plugin");
    expect(detail.statusCode).toBe(200);
    expect(detail.json().package.stats.downloads).toBe(1);
    await app.close();
  });

  it("returns package version history with a single latest tag", async () => {
    const app = await buildServer();
    const token = await signInWithGitHub(app);
    const basePayload = {
      name: "@tester/versioned-plugin",
      displayName: "Versioned Plugin",
      family: "code-plugin",
      summary: "Package with multiple versions.",
      compatibility: {
        pluginApi: "^1.0.0",
        minGatewayVersion: "2026.3.0",
      },
    };

    const first = await app.inject({
      method: "POST",
      url: "/api/v1/packages",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        ...basePayload,
        version: "0.1.0",
        changelog: "Initial version.",
      },
    });
    expect(first.statusCode).toBe(201);

    const second = await app.inject({
      method: "POST",
      url: "/api/v1/packages",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        ...basePayload,
        version: "0.2.0",
        changelog: "Adds registry metadata.",
      },
    });
    expect(second.statusCode).toBe(201);

    const detail = await app.inject("/api/v1/packages/%40tester%2Fversioned-plugin");
    expect(detail.statusCode).toBe(200);
    const body = detail.json<{
      package: {
        latestVersion: string;
        stats: { versions: number };
        versions: Array<{
          version: string;
          changelog: string;
          distTags: string[];
          sha256hash: string;
          files: Array<{ path: string }>;
        }>;
      };
    }>();
    expect(body.package.latestVersion).toBe("0.2.0");
    expect(body.package.stats.versions).toBe(2);
    expect(body.package.versions.map((version) => version.version)).toEqual(["0.2.0", "0.1.0"]);
    expect(body.package.versions[0]).toMatchObject({
      changelog: "Adds registry metadata.",
      distTags: ["latest"],
    });
    expect(body.package.versions[1].distTags).not.toContain("latest");
    expect(body.package.versions[0].sha256hash).toMatch(/^[a-f0-9]{64}$/);
    expect(body.package.versions[0].files.map((file) => file.path)).toContain("package.json");
    await app.close();
  });

  it("lets package owners manage settings, versions, deletion, rename, and transfer", async () => {
    const repo = new InMemoryRegistryRepository();
    await repo.createUser({
      handle: "receiver",
      email: "receiver@example.com",
      passwordHash: "test",
    });
    const app = await buildServer(repo);
    const token = await signInWithGitHub(app);
    const payload = {
      name: "@tester/manage-plugin",
      displayName: "Manage Plugin",
      family: "code-plugin",
      summary: "Owner managed package.",
      compatibility: {
        pluginApi: "^1.0.0",
        minGatewayVersion: "2026.3.0",
      },
    };

    const first = await app.inject({
      method: "POST",
      url: "/api/v1/packages",
      headers: { authorization: `Bearer ${token}` },
      payload: { ...payload, version: "0.1.0" },
    });
    expect(first.statusCode).toBe(201);

    const second = await app.inject({
      method: "POST",
      url: "/api/v1/packages",
      headers: { authorization: `Bearer ${token}` },
      payload: { ...payload, version: "0.2.0" },
    });
    expect(second.statusCode).toBe(201);

    const settings = await app.inject({
      method: "PATCH",
      url: "/api/v1/packages/%40tester%2Fmanage-plugin/settings",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        displayName: "Managed Plugin",
        summary: "Updated by the owner.",
        tags: ["owner-tools", "settings"],
      },
    });
    expect(settings.statusCode).toBe(200);
    expect(settings.json().package).toMatchObject({
      displayName: "Managed Plugin",
      summary: "Updated by the owner.",
      topics: ["owner-tools", "settings"],
    });

    const yanked = await app.inject({
      method: "POST",
      url: "/api/v1/packages/%40tester%2Fmanage-plugin/versions/0.2.0/yank",
      headers: { authorization: `Bearer ${token}` },
      payload: { message: "Bad release." },
    });
    expect(yanked.statusCode).toBe(200);
    expect(yanked.json().package.latestVersion).toBe("0.1.0");
    expect(yanked.json().package.versions.find((version: { version: string }) => version.version === "0.2.0")).toMatchObject({
      yankedAt: expect.any(Number),
      yankMessage: "Bad release.",
    });

    const deleted = await app.inject({
      method: "DELETE",
      url: "/api/v1/packages/%40tester%2Fmanage-plugin",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json().package.deletedAt).toEqual(expect.any(Number));
    expect((await app.inject("/api/v1/packages/%40tester%2Fmanage-plugin")).statusCode).toBe(404);

    const ownerList = await app.inject({
      method: "GET",
      url: "/api/v1/me/packages",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(ownerList.statusCode).toBe(200);
    expect(ownerList.json().items[0]).toMatchObject({ deletedAt: expect.any(Number) });

    const restored = await app.inject({
      method: "POST",
      url: "/api/v1/packages/%40tester%2Fmanage-plugin/restore",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(restored.statusCode).toBe(200);
    expect(restored.json().package.deletedAt).toBeNull();

    const renamed = await app.inject({
      method: "POST",
      url: "/api/v1/packages/%40tester%2Fmanage-plugin/rename",
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "@tester/renamed-plugin" },
    });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json().package.name).toBe("@tester/renamed-plugin");
    expect((await app.inject("/api/v1/packages/%40tester%2Fmanage-plugin")).statusCode).toBe(404);

    const transferred = await app.inject({
      method: "POST",
      url: "/api/v1/packages/%40tester%2Frenamed-plugin/transfer",
      headers: { authorization: `Bearer ${token}` },
      payload: { targetHandle: "receiver" },
    });
    expect(transferred.statusCode).toBe(200);
    expect(transferred.json().package.ownerHandle).toBe("receiver");
    await app.close();
  });

  it("supports organization publishers for package ownership", async () => {
    const repo = new InMemoryRegistryRepository();
    await repo.createUser({
      handle: "teammate",
      email: "teammate@example.com",
      passwordHash: "test",
    });
    const app = await buildServer(repo);
    const token = await signInWithGitHub(app);

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/organizations",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        handle: "kova-labs",
        displayName: "Kova Labs",
        description: "Shared KovaHub publishing.",
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().organization).toMatchObject({
      handle: "kova-labs",
      displayName: "Kova Labs",
    });

    const member = await app.inject({
      method: "POST",
      url: "/api/v1/organizations/kova-labs/members",
      headers: { authorization: `Bearer ${token}` },
      payload: { handle: "teammate", role: "maintainer" },
    });
    expect(member.statusCode).toBe(200);
    expect(member.json().member).toMatchObject({
      organizationHandle: "kova-labs",
      user: { handle: "teammate" },
      role: "maintainer",
    });

    const mine = await app.inject({
      method: "GET",
      url: "/api/v1/me/organizations",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(mine.statusCode).toBe(200);
    expect(mine.json().organizations).toEqual([
      expect.objectContaining({ handle: "kova-labs" }),
    ]);

    const publish = await app.inject({
      method: "POST",
      url: "/api/v1/packages",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: "@kova-labs/team-plugin",
        ownerHandle: "kova-labs",
        displayName: "Team Plugin",
        family: "code-plugin",
        version: "0.1.0",
        summary: "Published by a KovaHub organization.",
        compatibility: {
          pluginApi: "^1.0.0",
          minGatewayVersion: "2026.3.0",
        },
      },
    });
    expect(publish.statusCode).toBe(201);
    expect(publish.json().package).toMatchObject({
      name: "@kova-labs/team-plugin",
      ownerHandle: "kova-labs",
    });

    const listed = await app.inject("/api/v1/publishers/kova-labs/packages");
    expect(listed.statusCode).toBe(200);
    expect(listed.json().items).toEqual([
      expect.objectContaining({ name: "@kova-labs/team-plugin" }),
    ]);
    await app.close();
  });

  it("rejects plugin publishes without compatibility metadata", async () => {
    const app = await buildServer();
    const token = await signInWithGitHub(app);
    const publish = await app.inject({
      method: "POST",
      url: "/api/v1/packages",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: "@tester/no-compat",
        family: "code-plugin",
        version: "0.1.0",
      },
    });
    expect(publish.statusCode).toBe(400);
    expect(publish.json().error).toContain("compatibility.pluginApi");
    await app.close();
  });

  it("rejects scoped skill names that Kova cannot install as slugs", async () => {
    const app = await buildServer();
    const token = await signInWithGitHub(app);
    const publish = await app.inject({
      method: "POST",
      url: "/api/v1/packages",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: "@tester/scoped-skill",
        displayName: "Scoped Skill",
        family: "skill",
        version: "0.1.0",
      },
    });
    expect(publish.statusCode).toBe(400);
    expect(publish.json().error).toContain("Skill packages require a Kova skill slug");
    await app.close();
  });

  it("creates API tokens and accepts them for package publishing", async () => {
    const app = await buildServer();
    const jwt = await signInWithGitHub(app);
    const { token: apiToken } = await createApiToken(app, jwt);

    const publish = await app.inject({
      method: "POST",
      url: "/api/v1/packages",
      headers: { authorization: `Bearer ${apiToken}` },
      payload: {
        name: "@tester/token-plugin",
        displayName: "Token Plugin",
        family: "code-plugin",
        version: "0.1.0",
        compatibility: {
          pluginApi: "^1.0.0",
          minGatewayVersion: "2026.3.0",
        },
      },
    });
    expect(publish.statusCode).toBe(201);
    expect(publish.json().package.ownerHandle).toBe("tester");

    const tokens = await app.inject({
      method: "GET",
      url: "/api/v1/auth/tokens",
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(tokens.statusCode).toBe(200);
    expect(tokens.json().tokens[0].lastUsedAt).toEqual(expect.any(Number));

    const whoami = await app.inject({
      method: "GET",
      url: "/api/v1/whoami",
      headers: { authorization: `Bearer ${apiToken}` },
    });
    expect(whoami.statusCode).toBe(200);
    expect(whoami.json().user.handle).toBe("tester");
    await app.close();
  });

  it("supports CLI device login with GitHub session approval", async () => {
    const app = await buildServer();
    const jwt = await signInWithGitHub(app);

    const start = await app.inject({
      method: "POST",
      url: "/api/v1/auth/device/start",
      payload: { clientName: "test cli" },
    });
    expect(start.statusCode).toBe(200);
    expect(start.json()).toMatchObject({
      deviceCode: expect.any(String),
      userCode: expect.any(String),
      verificationUriComplete: expect.stringContaining("/auth/device"),
    });

    const pending = await app.inject({
      method: "POST",
      url: "/api/v1/auth/device/token",
      payload: { deviceCode: start.json().deviceCode },
    });
    expect(pending.statusCode).toBe(428);
    expect(pending.json().error).toBe("authorization_pending");

    const approved = await app.inject({
      method: "POST",
      url: "/api/v1/auth/device/approve",
      headers: { authorization: `Bearer ${jwt}` },
      payload: { userCode: start.json().userCode },
    });
    expect(approved.statusCode).toBe(200);
    expect(approved.json()).toMatchObject({
      approved: true,
      clientName: "test cli",
    });

    const token = await app.inject({
      method: "POST",
      url: "/api/v1/auth/device/token",
      payload: { deviceCode: start.json().deviceCode },
    });
    expect(token.statusCode).toBe(200);
    expect(token.json().accessToken).toEqual(expect.stringMatching(/^khp_/));

    const whoami = await app.inject({
      method: "GET",
      url: "/api/v1/whoami",
      headers: { authorization: `Bearer ${token.json().accessToken}` },
    });
    expect(whoami.statusCode).toBe(200);
    expect(whoami.json().user.handle).toBe("tester");
    await app.close();
  });

  it("imports packages from GitHub and restores publisher backups", async () => {
    const app = await buildServer();
    const jwt = await signInWithGitHub(app);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.endsWith("/package.json")) {
        return new Response(
          JSON.stringify({
            name: "@tester/github-plugin",
            version: "0.1.0",
            description: "Imported from GitHub.",
            kova: {
              compat: {
                pluginApi: "^1.0.0",
                minGatewayVersion: "2026.3.0",
              },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.endsWith("/README.md")) {
        return new Response("# GitHub Plugin\n", { status: 200 });
      }
      if (url.endsWith("/SKILL.md")) {
        return new Response("not found", { status: 404 });
      }
      throw new Error(`Unexpected GitHub import fetch: ${url}`);
    }) as typeof fetch;

    try {
      const preview = await app.inject({
        method: "POST",
        url: "/api/v1/import/github/preview",
        headers: { authorization: `Bearer ${jwt}` },
        payload: { repoUrl: "OpenKova/github-plugin" },
      });
      expect(preview.statusCode).toBe(200);
      expect(preview.json().package).toMatchObject({
        name: "@tester/github-plugin",
        family: "code-plugin",
        summary: "Imported from GitHub.",
      });

      const imported = await app.inject({
        method: "POST",
        url: "/api/v1/import/github",
        headers: { authorization: `Bearer ${jwt}` },
        payload: { repoUrl: "OpenKova/github-plugin" },
      });
      expect(imported.statusCode).toBe(201);
      expect(imported.json().package.name).toBe("@tester/github-plugin");
    } finally {
      globalThis.fetch = originalFetch;
    }

    const backup = await app.inject({
      method: "GET",
      url: "/api/v1/me/backup",
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(backup.statusCode).toBe(200);
    expect(backup.json().snapshot.packages).toEqual([
      expect.objectContaining({
        name: "@tester/github-plugin",
        version: "0.1.0",
        archiveBase64: expect.any(String),
      }),
    ]);
    await app.close();

    const restoreApp = await buildServer();
    const restoreJwt = await signInWithGitHub(restoreApp);
    const restored = await restoreApp.inject({
      method: "POST",
      url: "/api/v1/me/restore",
      headers: { authorization: `Bearer ${restoreJwt}` },
      payload: { packages: backup.json().snapshot.packages },
    });
    expect(restored.statusCode).toBe(200);
    expect(restored.json().restored).toEqual([
      expect.objectContaining({ name: "@tester/github-plugin" }),
    ]);
    await restoreApp.close();
  });

  it("restores GitHub browser sessions after an in-memory dev restart", async () => {
    const app = await buildServer();
    const jwt = await signInWithGitHub(app);
    await app.close();

    const restarted = await buildServer();
    const me = await restarted.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().user).toMatchObject({
      handle: "tester",
      email: "tester@example.com",
      displayName: "Tester",
    });

    const tokens = await restarted.inject({
      method: "POST",
      url: "/api/v1/auth/tokens",
      headers: { authorization: `Bearer ${jwt}` },
      payload: { name: "local cli" },
    });
    expect(tokens.statusCode).toBe(201);
    expect(tokens.json().token).toMatch(/^khp_/);
    await restarted.close();
  });

  it("rejects stale browser sessions without a 500", async () => {
    const app = await buildServer();
    const staleJwt = app.jwt.sign(
      {
        id: "missing-user",
        handle: "missing",
        email: "missing@example.com",
      },
      { sub: "missing-user" },
    );

    const tokens = await app.inject({
      method: "POST",
      url: "/api/v1/auth/tokens",
      headers: { authorization: `Bearer ${staleJwt}` },
      payload: { name: "local cli" },
    });
    expect(tokens.statusCode).toBe(401);
    expect(tokens.json().error).toBe("Session expired. Sign in with GitHub again.");

    const publish = await app.inject({
      method: "POST",
      url: "/api/v1/packages",
      headers: { authorization: `Bearer ${staleJwt}` },
      payload: {
        name: "@missing/session-plugin",
        family: "code-plugin",
        version: "0.1.0",
        compatibility: {
          pluginApi: "^1.0.0",
          minGatewayVersion: "2026.3.0",
        },
      },
    });
    expect(publish.statusCode).toBe(401);
    expect(publish.json().error).toBe("Session expired. Sign in with GitHub again.");
    await app.close();
  });

  it("lets GitHub users maintain public profile metadata", async () => {
    const app = await buildServer();
    const jwt = await signInWithGitHub(app);

    const update = await app.inject({
      method: "PATCH",
      url: "/api/v1/auth/profile",
      headers: { authorization: `Bearer ${jwt}` },
      payload: {
        displayName: "Tester Labs",
        bio: "Publishing Kova-compatible skills and plugins.",
        websiteUrl: "https://tester.example",
        company: "Tester Labs",
        location: "Remote",
      },
    });
    expect(update.statusCode).toBe(200);
    expect(update.json().user).toMatchObject({
      handle: "tester",
      displayName: "Tester Labs",
      bio: "Publishing Kova-compatible skills and plugins.",
      websiteUrl: "https://tester.example",
      company: "Tester Labs",
      location: "Remote",
    });

    const publish = await app.inject({
      method: "POST",
      url: "/api/v1/packages",
      headers: { authorization: `Bearer ${jwt}` },
      payload: {
        name: "@tester/profile-plugin",
        displayName: "Profile Plugin",
        family: "code-plugin",
        version: "0.1.0",
        compatibility: {
          pluginApi: "^1.0.0",
          minGatewayVersion: "2026.3.0",
        },
      },
    });
    expect(publish.statusCode).toBe(201);

    const profile = await app.inject("/api/v1/profiles/tester");
    expect(profile.statusCode).toBe(200);
    expect(profile.json().profile).toMatchObject({
      handle: "tester",
      displayName: "Tester Labs",
      bio: "Publishing Kova-compatible skills and plugins.",
      websiteUrl: "https://tester.example",
      stats: {
        packages: 1,
        plugins: 1,
        skills: 0,
      },
    });
    await app.close();
  });

  it("supports authenticated highlights, comments, and reports", async () => {
    const app = await buildServerWithPackageFixtures();
    const jwt = await signInWithGitHub(app);
    const packagePath = "/api/v1/packages/%40openkova%2Fcontext-bridge";

    const firstToggle = await app.inject({
      method: "POST",
      url: `${packagePath}/star/toggle`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(firstToggle.statusCode).toBe(200);
    expect(firstToggle.json()).toMatchObject({
      starred: true,
      stats: {
        stars: 1,
      },
    });

    const starState = await app.inject({
      method: "GET",
      url: `${packagePath}/star`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(starState.statusCode).toBe(200);
    expect(starState.json()).toEqual({ starred: true });

    const highlights = await app.inject({
      method: "GET",
      url: "/api/v1/stars",
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(highlights.statusCode).toBe(200);
    expect(highlights.json().items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "@openkova/context-bridge",
        }),
      ]),
    );

    const comment = await app.inject({
      method: "POST",
      url: `${packagePath}/comments`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { body: "Works well in a local Kova gateway." },
    });
    expect(comment.statusCode).toBe(201);
    expect(comment.json().comment).toMatchObject({
      packageName: "@openkova/context-bridge",
      user: { handle: "tester" },
      body: "Works well in a local Kova gateway.",
    });

    const comments = await app.inject(`${packagePath}/comments`);
    expect(comments.statusCode).toBe(200);
    expect(comments.json().items).toEqual([
      expect.objectContaining({
        body: "Works well in a local Kova gateway.",
      }),
    ]);

    const report = await app.inject({
      method: "POST",
      url: `${packagePath}/report`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { reason: "Please re-check the compatibility metadata." },
    });
    expect(report.statusCode).toBe(201);
    expect(report.json().report).toMatchObject({
      packageName: "@openkova/context-bridge",
      user: { handle: "tester" },
      reason: "Please re-check the compatibility metadata.",
      status: "open",
    });

    const deniedReports = await app.inject({
      method: "GET",
      url: "/api/v1/reviewer/reports",
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(deniedReports.statusCode).toBe(403);

    const previousReviewers = process.env.KOVAHUB_REVIEWER_HANDLES;
    process.env.KOVAHUB_REVIEWER_HANDLES = "tester";
    try {
      const reports = await app.inject({
        method: "GET",
        url: "/api/v1/reviewer/reports?status=open",
        headers: { authorization: `Bearer ${jwt}` },
      });
      expect(reports.statusCode).toBe(200);
      expect(reports.json().items).toEqual([
        expect.objectContaining({
          id: report.json().report.id,
          packageName: "@openkova/context-bridge",
          status: "open",
        }),
      ]);

      const reviewed = await app.inject({
        method: "PATCH",
        url: `/api/v1/reviewer/reports/${report.json().report.id}`,
        headers: { authorization: `Bearer ${jwt}` },
        payload: {
          status: "reviewed",
          moderationStatus: "approved",
          resolution: "Compatibility metadata is acceptable.",
        },
      });
      expect(reviewed.statusCode).toBe(200);
      expect(reviewed.json().report).toMatchObject({
        status: "reviewed",
        resolution: "Compatibility metadata is acceptable.",
        resolvedBy: { handle: "tester" },
      });

      const moderated = await app.inject({
        method: "PATCH",
        url: `${packagePath}/moderation`,
        headers: { authorization: `Bearer ${jwt}` },
        payload: {
          scanStatus: "clean",
          riskLevel: "low",
        },
      });
      expect(moderated.statusCode).toBe(200);
      expect(moderated.json().package.verification).toMatchObject({
        moderationStatus: "approved",
        scanStatus: "clean",
        riskLevel: "low",
      });
    } finally {
      if (previousReviewers === undefined) delete process.env.KOVAHUB_REVIEWER_HANDLES;
      else process.env.KOVAHUB_REVIEWER_HANDLES = previousReviewers;
    }

    const secondToggle = await app.inject({
      method: "POST",
      url: `${packagePath}/star/toggle`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(secondToggle.statusCode).toBe(200);
    expect(secondToggle.json()).toMatchObject({
      starred: false,
      stats: {
        stars: 0,
      },
    });
    await app.close();
  });

  it("supports reviewer bans, report auto-hide, and package hard-delete", async () => {
    const previousReviewers = process.env.KOVAHUB_REVIEWER_HANDLES;
    const previousThreshold = process.env.KOVAHUB_AUTO_HIDE_REPORT_THRESHOLD;
    process.env.KOVAHUB_REVIEWER_HANDLES = "reviewer";
    process.env.KOVAHUB_AUTO_HIDE_REPORT_THRESHOLD = "2";
    const repo = new InMemoryRegistryRepository();
    const reviewer = await repo.createUser({
      handle: "reviewer",
      email: "reviewer@example.com",
      passwordHash: "reviewer",
    });
    const app = await buildServer(repo);
    try {
      const userJwt = await signInWithGitHub(app);
      const reviewerJwt = app.jwt.sign(
        {
          id: reviewer.id,
          handle: reviewer.handle,
          email: reviewer.email,
        },
        { sub: reviewer.id },
      );

      const publish = await app.inject({
        method: "POST",
        url: "/api/v1/packages",
        headers: { authorization: `Bearer ${userJwt}` },
        payload: {
          name: "@tester/moderation-target",
          displayName: "Moderation Target",
          family: "code-plugin",
          version: "0.1.0",
          compatibility: {
            pluginApi: "^1.0.0",
            minGatewayVersion: "2026.3.0",
          },
        },
      });
      expect(publish.statusCode).toBe(201);

      const banned = await app.inject({
        method: "POST",
        url: "/api/v1/reviewer/users/tester/ban",
        headers: { authorization: `Bearer ${reviewerJwt}` },
        payload: { reason: "policy abuse" },
      });
      expect(banned.statusCode).toBe(200);
      expect(banned.json().user).toMatchObject({
        handle: "tester",
        bannedAt: expect.any(Number),
        banReason: "policy abuse",
      });

      const blocked = await app.inject({
        method: "POST",
        url: "/api/v1/auth/tokens",
        headers: { authorization: `Bearer ${userJwt}` },
        payload: { name: "blocked" },
      });
      expect(blocked.statusCode).toBe(403);
      expect(blocked.json().error).toContain("Account is banned");

      const unbanned = await app.inject({
        method: "DELETE",
        url: "/api/v1/reviewer/users/tester/ban",
        headers: { authorization: `Bearer ${reviewerJwt}` },
      });
      expect(unbanned.statusCode).toBe(200);
      expect(unbanned.json().user).toMatchObject({
        handle: "tester",
        bannedAt: null,
        banReason: null,
      });

      const packagePath = "/api/v1/packages/%40tester%2Fmoderation-target";
      for (const reason of ["First report.", "Second report."]) {
        const report = await app.inject({
          method: "POST",
          url: `${packagePath}/report`,
          headers: { authorization: `Bearer ${userJwt}` },
          payload: { reason },
        });
        expect(report.statusCode).toBe(201);
      }

      const hidden = await app.inject(packagePath);
      expect(hidden.statusCode).toBe(404);

      const hardDeleted = await app.inject({
        method: "DELETE",
        url: "/api/v1/reviewer/packages/%40tester%2Fmoderation-target",
        headers: { authorization: `Bearer ${reviewerJwt}` },
      });
      expect(hardDeleted.statusCode).toBe(200);
      expect(hardDeleted.json()).toEqual({ deleted: true });
    } finally {
      if (previousReviewers === undefined) delete process.env.KOVAHUB_REVIEWER_HANDLES;
      else process.env.KOVAHUB_REVIEWER_HANDLES = previousReviewers;
      if (previousThreshold === undefined) delete process.env.KOVAHUB_AUTO_HIDE_REPORT_THRESHOLD;
      else process.env.KOVAHUB_AUTO_HIDE_REPORT_THRESHOLD = previousThreshold;
      await app.close();
    }
  });

  it("lets reviewers merge duplicate packages into a canonical package", async () => {
    const previousReviewers = process.env.KOVAHUB_REVIEWER_HANDLES;
    process.env.KOVAHUB_REVIEWER_HANDLES = "reviewer";
    const repo = new InMemoryRegistryRepository();
    const reviewer = await repo.createUser({
      handle: "reviewer",
      email: "reviewer@example.com",
      passwordHash: "reviewer",
    });
    const app = await buildServer(repo);
    try {
      const userJwt = await signInWithGitHub(app);
      const reviewerJwt = app.jwt.sign(
        {
          id: reviewer.id,
          handle: reviewer.handle,
          email: reviewer.email,
        },
        { sub: reviewer.id },
      );
      const basePayload = {
        family: "code-plugin",
        compatibility: {
          pluginApi: "^1.0.0",
          minGatewayVersion: "2026.3.0",
        },
      };

      const canonical = await app.inject({
        method: "POST",
        url: "/api/v1/packages",
        headers: { authorization: `Bearer ${userJwt}` },
        payload: {
          ...basePayload,
          name: "@tester/canonical-plugin",
          displayName: "Canonical Plugin",
          version: "0.2.0",
          tags: ["canonical"],
        },
      });
      expect(canonical.statusCode).toBe(201);

      const duplicate = await app.inject({
        method: "POST",
        url: "/api/v1/packages",
        headers: { authorization: `Bearer ${userJwt}` },
        payload: {
          ...basePayload,
          name: "@tester/duplicate-plugin",
          displayName: "Duplicate Plugin",
          version: "0.1.0",
          tags: ["duplicate"],
        },
      });
      expect(duplicate.statusCode).toBe(201);

      const duplicatePath = "/api/v1/packages/%40tester%2Fduplicate-plugin";
      await app.inject({ method: "POST", url: `${duplicatePath}/install` });
      await app.inject({ method: "POST", url: `${duplicatePath}/star` });
      const comment = await app.inject({
        method: "POST",
        url: `${duplicatePath}/comments`,
        headers: { authorization: `Bearer ${userJwt}` },
        payload: { body: "This duplicate should move." },
      });
      expect(comment.statusCode).toBe(201);
      const report = await app.inject({
        method: "POST",
        url: `${duplicatePath}/report`,
        headers: { authorization: `Bearer ${userJwt}` },
        payload: { reason: "Duplicate of canonical package." },
      });
      expect(report.statusCode).toBe(201);

      const merged = await app.inject({
        method: "POST",
        url: "/api/v1/reviewer/packages/%40tester%2Fduplicate-plugin/merge",
        headers: { authorization: `Bearer ${reviewerJwt}` },
        payload: { targetName: "@tester/canonical-plugin" },
      });
      expect(merged.statusCode).toBe(200);
      expect(merged.json().package).toMatchObject({
        name: "@tester/canonical-plugin",
        latestVersion: "0.2.0",
        stats: {
          installs: 1,
          stars: 1,
          versions: 2,
        },
      });
      expect(merged.json().package.topics).toEqual(["canonical", "duplicate"]);
      expect(merged.json().package.versions.map((version: { version: string }) => version.version)).toEqual([
        "0.2.0",
        "0.1.0",
      ]);

      const missingSource = await app.inject(duplicatePath);
      expect(missingSource.statusCode).toBe(404);
      const movedComments = await app.inject("/api/v1/packages/%40tester%2Fcanonical-plugin/comments");
      expect(movedComments.json().items).toEqual([
        expect.objectContaining({ body: "This duplicate should move." }),
      ]);
      const reports = await app.inject({
        method: "GET",
        url: "/api/v1/reviewer/reports?status=open",
        headers: { authorization: `Bearer ${reviewerJwt}` },
      });
      expect(reports.json().items).toEqual([
        expect.objectContaining({ packageName: "@tester/canonical-plugin" }),
      ]);
    } finally {
      if (previousReviewers === undefined) delete process.env.KOVAHUB_REVIEWER_HANDLES;
      else process.env.KOVAHUB_REVIEWER_HANDLES = previousReviewers;
      await app.close();
    }
  });

  it("allows browser clients to revoke API tokens", async () => {
    const app = await buildServer();
    const jwt = await signInWithGitHub(app);
    const { apiToken } = await createApiToken(app, jwt);

    const preflight = await app.inject({
      method: "OPTIONS",
      url: `/api/v1/auth/tokens/${apiToken.id}`,
      headers: {
        origin: "http://localhost:5173",
        "access-control-request-method": "DELETE",
      },
    });
    expect(preflight.statusCode).toBe(204);
    expect(preflight.headers["access-control-allow-methods"]).toContain("DELETE");

    const revoke = await app.inject({
      method: "DELETE",
      url: `/api/v1/auth/tokens/${apiToken.id}`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(revoke.statusCode).toBe(204);

    const tokens = await app.inject({
      method: "GET",
      url: "/api/v1/auth/tokens",
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(tokens.statusCode).toBe(200);
    expect(tokens.json().tokens).toEqual([]);
    await app.close();
  });

  it("completes GitHub OAuth login and creates a KovaHub session", async () => {
    const previousClientId = process.env.GITHUB_CLIENT_ID;
    const previousClientSecret = process.env.GITHUB_CLIENT_SECRET;
    const previousSite = process.env.KOVAHUB_SITE;
    const previousRegistry = process.env.KOVAHUB_REGISTRY;
    const originalFetch = globalThis.fetch;

    process.env.GITHUB_CLIENT_ID = "test-github-client";
    process.env.GITHUB_CLIENT_SECRET = "test-github-secret";
    process.env.KOVAHUB_SITE = "http://localhost:5173";
    process.env.KOVAHUB_REGISTRY = "http://localhost:8787";

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url === "https://github.com/login/oauth/access_token") {
        return new Response(JSON.stringify({ access_token: "gho_test" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url === "https://api.github.com/user") {
        return new Response(
          JSON.stringify({
            id: 12345,
            login: "Octo-Builder",
            name: "Octo Builder",
            avatar_url: "https://avatars.example/octo.png",
            email: null,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url === "https://api.github.com/user/emails") {
        return new Response(
          JSON.stringify([{ email: "octo@example.com", primary: true, verified: true }]),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      throw new Error(`Unexpected GitHub fetch: ${url}`);
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const app = await buildServer();
    try {
      const start = await app.inject("/api/v1/auth/github/start?returnTo=%2Fpublish");
      expect(start.statusCode).toBe(302);
      const authorizeLocation = start.headers.location;
      expect(authorizeLocation).toEqual(expect.any(String));
      const authorize = new URL(authorizeLocation as string);
      expect(`${authorize.origin}${authorize.pathname}`).toBe("https://github.com/login/oauth/authorize");
      expect(authorize.searchParams.get("client_id")).toBe("test-github-client");
      expect(authorize.searchParams.get("redirect_uri")).toBe(
        "http://localhost:8787/api/v1/auth/github/callback",
      );
      expect(authorize.searchParams.get("scope")).toBe("read:user user:email");

      const state = authorize.searchParams.get("state");
      expect(state).toEqual(expect.any(String));
      const setCookie = start.headers["set-cookie"];
      const stateCookie = Array.isArray(setCookie) ? setCookie[0] : String(setCookie);
      const cookieHeader = stateCookie.split(";")[0];
      expect(cookieHeader).toContain("kovahub_github_state=");

      const callback = await app.inject({
        method: "GET",
        url: `/api/v1/auth/github/callback?code=oauth-code&state=${state}`,
        headers: { cookie: cookieHeader },
      });
      expect(callback.statusCode).toBe(302);
      const frontendCallback = new URL(callback.headers.location as string);
      expect(`${frontendCallback.origin}${frontendCallback.pathname}`).toBe(
        "http://localhost:5173/auth/github/callback",
      );
      expect(frontendCallback.searchParams.get("returnTo")).toBe("/publish");
      const token = new URLSearchParams(frontendCallback.hash.slice(1)).get("token");
      expect(token).toEqual(expect.any(String));

      const me = await app.inject({
        method: "GET",
        url: "/api/v1/auth/me",
        headers: { authorization: `Bearer ${token}` },
      });
      expect(me.statusCode).toBe(200);
      expect(me.json().user).toMatchObject({
        handle: "octo-builder",
        email: "octo@example.com",
      });
      expect(fetchMock).toHaveBeenCalledTimes(3);
    } finally {
      globalThis.fetch = originalFetch;
      if (previousClientId === undefined) delete process.env.GITHUB_CLIENT_ID;
      else process.env.GITHUB_CLIENT_ID = previousClientId;
      if (previousClientSecret === undefined) delete process.env.GITHUB_CLIENT_SECRET;
      else process.env.GITHUB_CLIENT_SECRET = previousClientSecret;
      if (previousSite === undefined) delete process.env.KOVAHUB_SITE;
      else process.env.KOVAHUB_SITE = previousSite;
      if (previousRegistry === undefined) delete process.env.KOVAHUB_REGISTRY;
      else process.env.KOVAHUB_REGISTRY = previousRegistry;
      await app.close();
    }
  });

  it("publishes a Kova plugin archive from multipart upload", async () => {
    const app = await buildServer();
    const jwt = await signInWithGitHub(app);
    const archive = buildKovaPluginArchive();
    const multipart = buildMultipartArchivePayload({
      archive,
      metadata: {
        displayName: "Archive Plugin",
        tags: ["archive", "kova"],
      },
    });

    const publish = await app.inject({
      method: "POST",
      url: "/api/v1/packages",
      headers: {
        authorization: `Bearer ${jwt}`,
        ...multipart.headers,
      },
      payload: multipart.payload,
    });
    expect(publish.statusCode).toBe(201);
    expect(publish.json().package).toMatchObject({
      name: "@tester/archive-plugin",
      displayName: "Archive Plugin",
      family: "code-plugin",
      latestVersion: "0.2.0",
      compatibility: {
        pluginApiRange: "^1.0.0",
        minGatewayVersion: "2026.4.0",
        builtWithKovaVersion: "2026.4.1",
        pluginSdkVersion: "1.0.0",
      },
    });
    expect(publish.json().package.capabilities.capabilityTags).toEqual([
      "plugin:code",
      "source:archive",
      "compat:gateway-min",
    ]);
    expect(publish.json().package.verification).toMatchObject({
      scanStatus: "clean",
      moderationStatus: "pending",
      riskLevel: "medium",
    });

    const version = await app.inject("/api/v1/packages/%40tester%2Farchive-plugin/versions/0.2.0");
    expect(version.statusCode).toBe(200);
    expect(version.json().version.files.map((file: { path: string }) => file.path)).toEqual([
      "package.json",
      "index.js",
      "README.md",
    ]);

    const download = await app.inject("/api/v1/packages/%40tester%2Farchive-plugin/download?tag=latest");
    expect(download.statusCode).toBe(200);
    expect(download.headers["x-kovahub-sha256"]).toBe(sha256Hex(archive));
    expect(download.rawPayload.equals(archive)).toBe(true);
    await app.close();
  });
});
