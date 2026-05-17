import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";
import { buildServerWithPackageFixtures } from "./fixtures.js";

describe("Kova client compatibility smoke", () => {
  it("exposes KovaHub environment aliases and route discovery", async () => {
    const app = await buildServer();

    const meta = await app.inject("/api/v1/meta");
    expect(meta.statusCode).toBe(200);
    expect(meta.json().compatibility.env).toEqual(
      expect.arrayContaining(["KOVA_KOVAHUB_URL", "KOVAHUB_URL", "KOVAHUB_REGISTRY", "KOVAHUB_SITE"]),
    );

    const wellKnown = await app.inject("/.well-known/kovahub.json");
    expect(wellKnown.statusCode).toBe(200);
    expect(wellKnown.json()).toMatchObject({
      name: "KovaHub",
      routes: {
        packages: "/api/v1/packages",
        skills: "/api/v1/skills",
        search: "/api/v1/search",
        whoami: "/api/v1/whoami",
      },
      env: {
        url: "KOVAHUB_URL",
        kovaUrl: "KOVA_KOVAHUB_URL",
      },
    });

    await app.close();
  });

  it("serves the Kova package lookup, version, and archive download shapes", async () => {
    const app = await buildServerWithPackageFixtures();

    const search = await app.inject("/api/v1/packages/search?q=context&family=code-plugin&limit=5");
    expect(search.statusCode).toBe(200);
    expect(search.json().results[0]).toMatchObject({
      score: expect.any(Number),
      package: {
        name: "@openkova/context-bridge",
        family: "code-plugin",
        latestVersion: "0.1.0",
      },
    });

    const detail = await app.inject("/api/v1/packages/%40openkova%2Fcontext-bridge");
    expect(detail.statusCode).toBe(200);
    expect(detail.json().package).toMatchObject({
      name: "@openkova/context-bridge",
      compatibility: {
        pluginApiRange: "^1.0.0",
        minGatewayVersion: "2026.3.0",
      },
      verification: {
        tier: "structural",
        scanStatus: "clean",
      },
    });

    const version = await app.inject("/api/v1/packages/%40openkova%2Fcontext-bridge/versions/0.1.0");
    expect(version.statusCode).toBe(200);
    expect(version.json().version).toMatchObject({
      version: "0.1.0",
      sha256hash: expect.stringMatching(/^[a-f0-9]{64}$/),
      files: expect.arrayContaining([
        expect.objectContaining({
          path: "package.json",
          sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
      ]),
    });

    const download = await app.inject("/api/v1/packages/%40openkova%2Fcontext-bridge/download?tag=latest");
    expect(download.statusCode).toBe(200);
    expect(download.headers["content-type"]).toContain("application/zip");
    expect(download.headers["x-kovahub-sha256"]).toMatch(/^[a-f0-9]{64}$/);
    expect(Object.keys(unzipSync(new Uint8Array(download.rawPayload)))).toEqual(
      expect.arrayContaining(["package.json", "README.md"]),
    );

    await app.close();
  });

  it("serves the Kova skill search, detail, and install archive shapes", async () => {
    const app = await buildServerWithPackageFixtures();

    const search = await app.inject("/api/v1/search?q=release&limit=5");
    expect(search.statusCode).toBe(200);
    expect(search.json().results[0]).toMatchObject({
      score: expect.any(Number),
      slug: "release-notes-sherpa",
      displayName: "Release Notes Sherpa",
      version: "1.0.0",
    });

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
      metadata: {
        os: null,
        systems: null,
      },
    });

    const download = await app.inject("/api/v1/download?slug=release-notes-sherpa&version=1.0.0");
    expect(download.statusCode).toBe(200);
    expect(download.headers["content-type"]).toContain("application/zip");
    expect(Object.keys(unzipSync(new Uint8Array(download.rawPayload)))).toContain("SKILL.md");

    await app.close();
  });
});
