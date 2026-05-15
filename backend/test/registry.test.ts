import { describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";

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
});
