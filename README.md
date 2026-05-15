# KovaHub

KovaHub is a fresh Kova/OpenClaw-compatible marketplace for publishing and installing plugins, bundle plugins, and skills.

The MVP scaffold is intentionally small: a TypeScript backend exposes ClawHub-compatible registry routes, a React/Vite frontend provides the marketplace UI, and `database/` contains the Postgres target schema for the first persistent implementation.

## Stack

- `backend/`: Fastify, Zod, JWT auth, in-memory development repository, ZIP archive generation.
- `frontend/`: React, Vite, lucide icons, ClawHub-inspired dark marketplace UI.
- `database/`: Postgres DDL for users, packages, versions, files, and API tokens.
- Package manager: `pnpm`.

## Development

```bash
pnpm install
pnpm dev:backend
pnpm dev:frontend
```

Default local URLs:

- Frontend: `http://localhost:5173`
- Registry API: `http://localhost:8787`

For local Kova/OpenClaw testing:

```bash
export CLAWHUB_SITE=http://localhost:5173
export CLAWHUB_REGISTRY=http://localhost:8787
export OPENCLAW_CLAWHUB_URL=http://localhost:8787
```

## Checks

```bash
pnpm typecheck
pnpm test
pnpm build
```

Rendered frontend QA uses Playwright:

```bash
pnpm exec playwright install chromium
```

## MVP Features

Implemented in the scaffold:

- Account registration, login, and bearer-token auth.
- Publish package endpoint for `skill`, `code-plugin`, and `bundle-plugin`.
- Package list/search.
- Package detail and version detail API shapes.
- Latest version tag behavior.
- ZIP archive download endpoints.
- Plugin compatibility metadata:
  - publish accepts `compatibility.pluginApi`
  - registry responses expose `compatibility.pluginApiRange`
  - registry responses expose `compatibility.minGatewayVersion`
- Kova/OpenClaw-compatible registry target env docs.

Registry-compatible read routes:

- `GET /api/v1/packages`
- `GET /api/v1/packages/search?q=...`
- `GET /api/v1/packages/:name`
- `GET /api/v1/packages/:name/versions/:version`
- `GET /api/v1/packages/:name/download?version=...`
- `GET /api/v1/search?q=...`
- `GET /api/v1/skills`
- `GET /api/v1/skills/:slug`
- `GET /api/v1/download?slug=...&version=...`

Auth and publish routes:

- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`
- `GET /api/v1/auth/me`
- `POST /api/v1/packages`

## Next MVP Steps

1. Replace the in-memory repository with Postgres persistence using `database/migrations/0001_init.sql`.
2. Add durable archive storage under local filesystem/S3-compatible storage.
3. Add API token auth for CLI publishing.
4. Add multipart archive publishing and server-side package inspection.
5. Validate plugin package metadata from `package.json`:
   - `openclaw.compat.pluginApi`
   - `openclaw.compat.minGatewayVersion`
   - `openclaw.build.openclawVersion`
6. Add moderation/security scan placeholders before packages become public.
7. Add pagination, tags, owner pages, and version history to the frontend.

## References

- Kova/OpenClaw reference repo: `/home/chirag/kova`
- ClawHub reference repo inspected from `https://github.com/openclaw/clawhub.git`

The Kova reference was used only for docs/contracts. ClawHub is MIT-licensed; this scaffold uses original code with a ClawHub-inspired visual direction.
