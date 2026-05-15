# KovaHub

KovaHub is a fresh Kova-compatible marketplace for publishing and installing plugins, bundle plugins, and skills.

The MVP scaffold is intentionally small: a TypeScript backend exposes KovaHub registry routes, a React/Vite frontend provides the marketplace UI, and `database/` contains the Postgres schema used by the persistent backend mode.

## Stack

- `backend/`: Fastify, Zod, JWT auth, in-memory development repository, optional Postgres persistence, local archive storage, ZIP archive generation.
- `frontend/`: React, Vite, lucide icons, dark KovaHub marketplace UI.
- `database/`: Postgres DDL for users, packages, versions, files, and API tokens.
- Package manager: `pnpm`.

## Development

```bash
pnpm install
cp .env.example .env
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

For local Kova testing:

```bash
export KOVAHUB_SITE=http://localhost:5173
export KOVAHUB_REGISTRY=http://localhost:8787
```

For GitHub login, create a GitHub OAuth app and set its callback URL to:

```text
http://localhost:8787/api/v1/auth/github/callback
```

Then set these in `.env` or export them in the backend shell:

```bash
export GITHUB_CLIENT_ID=...
export GITHUB_CLIENT_SECRET=...
export GITHUB_CALLBACK_URL=http://localhost:8787/api/v1/auth/github/callback
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

- GitHub OAuth browser sign-in and bearer-token auth.
- API token creation and bearer-token publishing for CLI/client integrations.
- Publish package endpoint for `skill`, `code-plugin`, and `bundle-plugin`.
- Multipart ZIP archive publishing with server-side `package.json`/`SKILL.md` inspection.
- Optional Postgres persistence for users, packages, versions, files, and package stats.
- Durable local archive storage for persistent mode.
- Package list/search.
- Package detail page with compatibility, capability signals, stats, and version history.
- Package detail and version detail API shapes.
- Latest version tag behavior.
- ZIP archive download endpoints.
- Frontend compose publishing, archive ZIP publishing, and API token management.
- Plugin compatibility metadata:
  - publish accepts `compatibility.pluginApi`
  - registry responses expose `compatibility.pluginApiRange`
  - registry responses expose `compatibility.minGatewayVersion`
- Kova-compatible registry target env docs.

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

- `GET /api/v1/auth/github/start?returnTo=/publish`
- `GET /api/v1/auth/github/callback`
- `GET /api/v1/auth/me`
- `GET /api/v1/auth/tokens`
- `POST /api/v1/auth/tokens`
- `DELETE /api/v1/auth/tokens/:id`
- `POST /api/v1/packages`

Create an API token with a session JWT, then use the returned `khp_...` token as a bearer token for publishing:

```bash
curl -X POST http://localhost:8787/api/v1/auth/tokens \
  -H "authorization: Bearer $KOVAHUB_JWT" \
  -H "content-type: application/json" \
  -d '{"name":"local cli"}'

curl -X POST http://localhost:8787/api/v1/packages \
  -H "authorization: Bearer $KOVAHUB_API_TOKEN" \
  -H "content-type: application/json" \
  -d @package-publish.json
```

The same publish endpoint accepts multipart archive uploads. The uploaded file must be a ZIP in form field `archive`; optional publish overrides can be supplied as a JSON `metadata` field:

```bash
curl -X POST http://localhost:8787/api/v1/packages \
  -H "authorization: Bearer $KOVAHUB_API_TOKEN" \
  -F archive=@./my-kova-plugin.zip \
  -F 'metadata={"displayName":"My Kova Plugin","tags":["plugin","kova"]};type=application/json'
```

For Kova plugin archives, `package.json` must declare:

- `kova.compat.pluginApi`
- `kova.compat.minGatewayVersion` or `kova.install.minHostVersion`
- `kova.build.kovaVersion`

Archive upload limits are controlled by `KOVAHUB_MAX_ARCHIVE_BYTES`, `KOVAHUB_MAX_ARCHIVE_ENTRIES`, and `KOVAHUB_MAX_EXTRACTED_BYTES`.

## Remaining Hardening

1. Add S3/R2-compatible archive storage for hosted deployments.
2. Add moderation/security scan placeholders before packages become public.
3. Add pagination, tag pages, owner pages, and richer package discovery.
4. Add compatibility smoke tests against the local Kova reference contracts.

## References

- Kova reference repo: `/home/chirag/kova`
- ClawHub reference repo inspected from `https://github.com/openclaw/clawhub.git`

The Kova reference was used only for docs/contracts. ClawHub is MIT-licensed and was inspected only as a visual/product reference; this scaffold uses original KovaHub code and Kova package metadata.
