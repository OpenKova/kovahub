import { createHash } from "node:crypto";
import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";

const multipartBoundary = "----kovahub-test-boundary";

async function registerAndLogin(app: Awaited<ReturnType<typeof buildServer>>) {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/auth/register",
    payload: {
      handle: "tester",
      email: "tester@example.com",
      password: "correct-horse",
    },
  });
  expect(response.statusCode).toBe(200);
  return response.json<{ token: string }>().token;
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
  return body.token;
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
  it("serves KovaHub-compatible package search and detail responses", async () => {
    const app = await buildServer();
    const search = await app.inject("/api/v1/packages/search?q=context");
    expect(search.statusCode).toBe(200);
    const body = search.json<{ results: Array<{ package: { name: string } }> }>();
    expect(body.results[0]?.package.name).toBe("@openkova/context-bridge");

    const detail = await app.inject("/api/v1/packages/%40openkova%2Fcontext-bridge");
    expect(detail.statusCode).toBe(200);
    expect(detail.json().package.compatibility.pluginApiRange).toBe("^1.0.0");
    await app.close();
  });

  it("publishes a plugin package with latest tag and downloadable archive", async () => {
    const app = await buildServer();
    const token = await registerAndLogin(app);

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

    const version = await app.inject("/api/v1/packages/%40tester%2Fdemo-plugin/versions/0.1.0");
    expect(version.statusCode).toBe(200);
    expect(version.json().version.distTags).toContain("latest");

    const download = await app.inject("/api/v1/packages/%40tester%2Fdemo-plugin/download?tag=latest");
    expect(download.statusCode).toBe(200);
    expect(download.headers["content-type"]).toContain("application/zip");
    expect(download.rawPayload.byteLength).toBeGreaterThan(20);
    await app.close();
  });

  it("rejects plugin publishes without compatibility metadata", async () => {
    const app = await buildServer();
    const token = await registerAndLogin(app);
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

  it("creates API tokens and accepts them for package publishing", async () => {
    const app = await buildServer();
    const jwt = await registerAndLogin(app);
    const apiToken = await createApiToken(app, jwt);

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
    await app.close();
  });

  it("publishes a Kova plugin archive from multipart upload", async () => {
    const app = await buildServer();
    const jwt = await registerAndLogin(app);
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
