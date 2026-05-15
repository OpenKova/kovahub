# KovaHub

KovaHub is a fresh Kova/OpenClaw-compatible marketplace for publishing and installing plugins, bundle plugins, and skills.

The MVP scaffold is intentionally small: a TypeScript backend exposes ClawHub-compatible registry routes, a React/Vite frontend provides the marketplace UI, and `database/` contains the Postgres schema used by the persistent backend mode.

## Stack

- `backend/`: Fastify, Zod, JWT auth, in-memory development repository, optional Postgres persistence, local archive storage, ZIP archive generation.
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

The backend defaults to the in-memory repository so the app starts with no services installed. To run the persistent mode, provide `DATABASE_URL`; migrations run automatically and package archives are written under `KOVAHUB_ARCHIVE_DIR`:

```bash
export DATABASE_URL=postgres://postgres:postgres@localhost:5432/kovahub
export KOVAHUB_ARCHIVE_DIR=.kovahub/archives
pnpm dev:backend
```

Set `KOVAHUB_SEED_DATABASE=false` to skip the seed packages in a persistent database.

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
- Optional Postgres persistence for users, packages, versions, files, and package stats.
- Durable local archive storage for persistent mode.
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

1. Add API token auth for CLI publishing.
2. Add multipart archive publishing and server-side package inspection.
3. Validate plugin package metadata from `package.json`:
   - `openclaw.compat.pluginApi`
   - `openclaw.compat.minGatewayVersion`
   - `openclaw.build.openclawVersion`
4. Add S3/R2-compatible archive storage for hosted deployments.
5. Add moderation/security scan placeholders before packages become public.
6. Add pagination, tags, owner pages, and version history to the frontend.

## References

- Kova/OpenClaw reference repo: `/home/chirag/kova`
- ClawHub reference repo inspected from `https://github.com/openclaw/clawhub.git`

The Kova reference was used only for docs/contracts. ClawHub is MIT-licensed; this scaffold uses original code with a ClawHub-inspired visual direction.
