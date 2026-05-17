export const openApiDocument = {
  openapi: "3.1.0",
  info: {
    title: "KovaHub Registry API",
    version: "0.1.0",
    description: "Kova-compatible marketplace and registry API for skills, code plugins, and bundle plugins.",
  },
  servers: [{ url: "/" }],
  paths: {
    "/.well-known/kovahub.json": {
      get: { summary: "Registry discovery document", responses: { "200": { description: "Discovery metadata" } } },
    },
    "/api/v1/meta": {
      get: { summary: "Registry metadata", responses: { "200": { description: "KovaHub metadata" } } },
    },
    "/api/v1/packages": {
      get: { summary: "List packages", responses: { "200": { description: "Package page" } } },
      post: { summary: "Publish a package", responses: { "201": { description: "Published package" } } },
    },
    "/api/v1/packages/search": {
      get: { summary: "Search packages", responses: { "200": { description: "Search results" } } },
    },
    "/api/v1/search/suggestions": {
      get: { summary: "Search suggestions", responses: { "200": { description: "Package, tag, and publisher suggestions" } } },
    },
    "/api/v1/packages/{name}": {
      get: { summary: "Package detail", responses: { "200": { description: "Package detail" } } },
      delete: { summary: "Soft-delete a package", responses: { "200": { description: "Deleted package" } } },
    },
    "/api/v1/packages/{name}/download": {
      get: { summary: "Download package archive", responses: { "200": { description: "ZIP archive" } } },
    },
    "/api/v1/packages/{name}/versions": {
      get: { summary: "List package versions", responses: { "200": { description: "Version page" } } },
    },
    "/api/v1/auth/github/start": {
      get: { summary: "Start GitHub OAuth", responses: { "302": { description: "GitHub redirect" } } },
    },
    "/api/v1/auth/device/start": {
      post: { summary: "Start CLI device login", responses: { "200": { description: "Device login challenge" } } },
    },
    "/api/v1/auth/device/approve": {
      post: { summary: "Approve CLI device login", responses: { "200": { description: "Device approval status" } } },
    },
    "/api/v1/auth/device/token": {
      post: { summary: "Poll CLI device token", responses: { "200": { description: "API token" } } },
    },
    "/api/v1/auth/tokens": {
      get: { summary: "List API tokens", responses: { "200": { description: "API tokens" } } },
      post: { summary: "Create API token", responses: { "201": { description: "Created API token" } } },
    },
    "/api/v1/import/github": {
      post: { summary: "Import and publish from GitHub", responses: { "201": { description: "Published package" } } },
    },
    "/api/v1/reviewer/users/{handle}/ban": {
      post: { summary: "Ban a user", responses: { "200": { description: "Banned user" } } },
      delete: { summary: "Unban a user", responses: { "200": { description: "Unbanned user" } } },
    },
    "/api/v1/reviewer/packages/{name}": {
      delete: { summary: "Hard-delete a package", responses: { "200": { description: "Hard-delete result" } } },
    },
    "/api/v1/reviewer/packages/{name}/merge": {
      post: { summary: "Merge duplicate package into a target", responses: { "200": { description: "Merged package" } } },
    },
    "/api/v1/me/backup": {
      get: { summary: "Export publisher package backup", responses: { "200": { description: "Backup snapshot" } } },
    },
    "/api/v1/me/restore": {
      post: { summary: "Restore publisher package backup", responses: { "200": { description: "Restore result" } } },
    },
  },
} as const;
