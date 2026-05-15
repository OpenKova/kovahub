import { createHash } from "node:crypto";
import { strToU8, unzipSync, zipSync } from "fflate";
import { describe, expect, it, vi } from "vitest";
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
      scanStatus: "pending",
      moderationStatus: "approved",
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
        ],
      },
    });
    expect(publish.statusCode).toBe(201);
    expect(publish.json().package.latestVersion).toBe("0.1.0");
    expect(publish.json().package.topics).toEqual(["demo", "gateway"]);
    expect(publish.json().package).toMatchObject({
      scanStatus: "pending",
      moderationStatus: "pending",
      verification: {
        scanStatus: "pending",
        moderationStatus: "pending",
        riskLevel: "unknown",
      },
    });

    const version = await app.inject("/api/v1/packages/%40tester%2Fdemo-plugin/versions/0.1.0");
    expect(version.statusCode).toBe(200);
    expect(version.json().version.distTags).toContain("latest");
    expect(version.json().version.verification).toMatchObject({
      scanStatus: "pending",
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
    });

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
      scanStatus: "pending",
      moderationStatus: "pending",
      riskLevel: "unknown",
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
