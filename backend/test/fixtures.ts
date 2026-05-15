import { buildServer } from "../src/server.js";
import { InMemoryRegistryRepository } from "../src/repository.js";

export async function buildServerWithPackageFixtures() {
  const repo = new InMemoryRegistryRepository();
  let owner = await repo.createUser({
    handle: "openkova",
    email: "fixture@kovahub.test",
    passwordHash: "fixture-account-disabled",
  });
  owner = await repo.updateUserProfile(owner.id, {
    displayName: "OpenKova",
    bio: "Kova-compatible package fixtures.",
    websiteUrl: "https://github.com/OpenKova",
    company: "OpenKova",
  });

  await repo.publishPackage(
    {
      name: "@openkova/context-bridge",
      displayName: "Context Bridge",
      family: "code-plugin",
      version: "0.1.0",
      summary: "Gateway-side context extension for Kova agents.",
      changelog: "Fixture package.",
      channel: "official",
      tags: ["context", "gateway"],
      compatibility: {
        pluginApi: "^1.0.0",
        minGatewayVersion: "2026.3.0",
        builtWithKovaVersion: "2026.3.0",
      },
      capabilities: {
        executesCode: true,
        runtimeId: "@openkova/context-bridge",
        providers: ["context"],
        capabilityTags: ["provider:context", "requires:gateway"],
      },
      files: [
        {
          path: "package.json",
          content: `${JSON.stringify(
            {
              name: "@openkova/context-bridge",
              version: "0.1.0",
              kova: {
                compat: {
                  pluginApi: "^1.0.0",
                  minGatewayVersion: "2026.3.0",
                },
                build: {
                  kovaVersion: "2026.3.0",
                },
              },
            },
            null,
            2,
          )}\n`,
          contentType: "application/json",
        },
        {
          path: "README.md",
          content: "# Context Bridge\n\nGateway-side context extension fixture package.\n",
          contentType: "text/markdown",
        },
      ],
    },
    owner,
  );

  await repo.publishPackage(
    {
      name: "release-notes-sherpa",
      displayName: "Release Notes Sherpa",
      family: "skill",
      version: "1.0.0",
      summary: "Turns changelogs and commit ranges into concise release notes.",
      changelog: "Fixture skill.",
      channel: "community",
      tags: ["docs", "release-notes"],
      files: [
        {
          path: "SKILL.md",
          content:
            "---\nname: release-notes-sherpa\ndescription: Draft release notes from commits and changelogs.\n---\n\nUse this skill to summarize release changes.\n",
          contentType: "text/markdown",
        },
      ],
    },
    owner,
  );

  return buildServer(repo);
}
