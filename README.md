# KovaHub

KovaHub is a fresh Kova-compatible marketplace for publishing and installing plugins, bundle plugins, and skills.

The MVP scaffold is intentionally small: a TypeScript backend exposes KovaHub registry routes, a React/Vite frontend provides the marketplace UI, a first-party CLI exercises device login, and `database/` contains the Postgres schema used by the persistent backend mode.

## Stack

- `backend/`: Fastify, Zod, JWT auth, in-memory development repository, optional Postgres persistence, local or S3/R2-compatible archive storage, ZIP archive generation.
- `frontend/`: React, Vite, lucide icons, ClawHub-inspired KovaHub marketplace UI.
- `cli/`: first-party KovaHub CLI skeleton for login, whoami, and publish workflows.
- `database/`: Postgres DDL for users, organizations, packages, versions, files, tokens, moderation, and device auth.
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

The backend defaults to the in-memory repository so the app starts with no services installed and no sample packages. To run the persistent mode, provide `DATABASE_URL`; migrations run automatically and package archives are written under `KOVAHUB_ARCHIVE_DIR` by default:

```bash
export DATABASE_URL=postgres://postgres:postgres@localhost:5432/kovahub
export KOVAHUB_ARCHIVE_DIR=.kovahub/archives
pnpm dev:backend
```

For hosted deployments, set `KOVAHUB_ARCHIVE_STORAGE=s3` or `r2` to store archives in an S3-compatible bucket instead of the local filesystem:

```bash
export KOVAHUB_ARCHIVE_STORAGE=s3
export KOVAHUB_S3_ENDPOINT=https://example.r2.cloudflarestorage.com
export KOVAHUB_S3_BUCKET=kovahub
export KOVAHUB_S3_REGION=auto
export KOVAHUB_S3_ACCESS_KEY_ID=...
export KOVAHUB_S3_SECRET_ACCESS_KEY=...
export KOVAHUB_S3_PREFIX=archives
```

For local Kova testing:

```bash
export KOVA_KOVAHUB_URL=http://localhost:8787
export KOVAHUB_URL=http://localhost:8787
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

Reviewer/moderation access is controlled by GitHub handles:

```bash
export KOVAHUB_REVIEWER_HANDLES=your-github-handle,another-reviewer
```

## Checks

```bash
pnpm typecheck
pnpm test
pnpm build
```

Browser E2E coverage starts isolated local backend/frontend ports and uses an in-memory registry:

```bash
pnpm exec playwright install chromium
pnpm test:e2e
```

Run the Kova registry contract check against a local or hosted registry:

```bash
pnpm test:kova-contract
KOVAHUB_REGISTRY_URL=https://your-registry.example.com pnpm test:kova-contract
```

## Deployment

For the free MVP hosting path, use Vercel for the frontend/API function and Supabase for Postgres plus archive storage. See [docs/deploy-vercel-supabase.md](docs/deploy-vercel-supabase.md).

Rendered frontend QA uses Playwright:

```bash
pnpm exec playwright install chromium
```

## MVP Features

Implemented in the scaffold:

- GitHub OAuth browser sign-in and bearer-token auth.
- Public publisher profiles and signed-in profile editing.
- Authenticated package highlights/starred packages.
- Publisher dashboard with package activity and token management.
- API token creation and bearer-token publishing for CLI/client integrations.
- Device-code auth for the first-party CLI.
- Publish package endpoint for `skill`, `code-plugin`, and `bundle-plugin`.
- Multipart ZIP archive publishing with server-side `package.json`/`SKILL.md` inspection.
- Optional Postgres persistence for users, organizations, packages, versions, files, tokens, moderation, and package stats.
- Durable local archive storage for persistent mode.
- S3/R2-compatible archive storage for hosted persistent mode.
- Package list/search.
- Package topics, owner filters, tag filters, cursor pagination, search suggestions, and dedicated publisher/topic pages.
- Discovery sorting by recent, trending, and popular signals.
- Download, install, and star counters exposed in package stats.
- Package detail page with compatibility, capability signals, stats, and version history.
- Package detail tabs for overview, versions, compatibility, files, and discussion.
- README/SKILL documentation extraction from package archives with safe React rendering on package detail pages.
- Package comments and authenticated package reports.
- Reviewer moderation queue for reported packages.
- Reviewer moderation hardening: user bans, report-threshold auto-hide, package hard-delete, and duplicate package merge.
- Reviewer assignment workflow and authenticated notification feed for reports/moderation events.
- Production ops basics: health/readiness endpoints, optional protected metrics, built-in rate limits, and backup export retention controls.
- Unified search page with all/skills/plugins filters.
- Search ranking with local query expansion, vector-style similarity scoring, matched fields, highlights, and Postgres search indexes.
- Audit page for security scan and moderation signals.
- Owner package settings for metadata edits, rename, transfer, restore, delete, and yanking.
- Organization publishers with member roles.
- GitHub repository import preview/publish plus publisher backup/restore endpoints.
- Package detail and version detail API shapes.
- Latest version tag behavior.
- ZIP archive download endpoints.
- Structural archive security scan signals, source/provenance metadata, publish signature receipts, scanner hooks, rebuild verification records, and moderation status in package verification metadata.
- First-party CLI login, publish, install, update, sync, pin, unpin, and local list workflows.
- Frontend compose publishing, archive ZIP publishing, and API token management.
- OpenAPI document at `/openapi.json`, baseline security headers, and GitHub Actions CI.
- Browser E2E harness for publish, dashboard, device-login approval, and moderation queue flows.
- Plugin compatibility metadata:
  - publish accepts `compatibility.pluginApi`
  - registry responses expose `compatibility.pluginApiRange`
  - registry responses expose `compatibility.minGatewayVersion`
- Kova-compatible registry target env docs.
- Kova client compatibility smoke tests and a deployable registry contract check for package, skill, version, and archive routes.

ClawHub-inspired frontend routes now present in KovaHub:

- `/` home
- `/search`
- `/skills`
- `/plugins`
- `/publishers`
- `/stars`
- `/dashboard`
- `/audits`
- `/docs`
- `/marketplace`
- `/publish`
- `/skills/publish`
- `/plugins/publish`
- `/auth/device`
- `/packages/:name`
- `/plugins/:name`
- `/skills/:slug`
- `/publishers/:handle`
- `/tags/:tag`

Registry-compatible read routes:

- `GET /openapi.json`
- `GET /.well-known/kovahub.json`
- `GET /api/v1/packages?q=...&family=...&owner=...&tag=...&cursor=...&limit=...`
- `GET /api/v1/packages/search?q=...&family=...&owner=...&tag=...`
- `GET /api/v1/search/suggestions?q=...`
- `GET /api/v1/packages/trending`
- `GET /api/v1/packages/:name`
- `GET /api/v1/packages/:name/comments`
- `GET /api/v1/packages/:name/star`
- `GET /api/v1/packages/:name/versions`
- `GET /api/v1/packages/:name/versions/:version`
- `GET /api/v1/packages/:name/download?version=...`
- `POST /api/v1/packages/:name/install`
- `POST /api/v1/packages/:name/star`
- `POST /api/v1/packages/:name/star/toggle`
- `POST /api/v1/packages/:name/comments`
- `POST /api/v1/packages/:name/report`
- `GET /api/v1/stars`
- `GET /api/v1/profiles/:handle`
- `GET /api/v1/publishers/:handle/packages`
- `GET /api/v1/tags/:tag/packages`
- `GET /api/v1/plugins`
- `GET /api/v1/plugins/search?q=...`
- `GET /api/v1/code-plugins`
- `GET /api/v1/code-plugins/search?q=...`
- `GET /api/v1/bundle-plugins`
- `GET /api/v1/bundle-plugins/search?q=...`
- `GET /api/v1/search?q=...`
- `GET /api/v1/skills`
- `GET /api/v1/skills/:slug`
- `GET /api/v1/skills/:slug/versions`
- `GET /api/v1/download?slug=...&version=...`

Auth and publish routes:

- `GET /api/v1/auth/github/start?returnTo=/publish`
- `GET /api/v1/auth/github/callback`
- `GET /api/v1/auth/me`
- `GET /api/v1/auth/profile`
- `PATCH /api/v1/auth/profile`
- `POST /api/v1/auth/device/start`
- `POST /api/v1/auth/device/approve`
- `POST /api/v1/auth/device/token`
- `GET /api/v1/whoami`
- `GET /api/v1/auth/tokens`
- `POST /api/v1/auth/tokens`
- `DELETE /api/v1/auth/tokens/:id`
- `GET /api/v1/me/packages`
- `GET /api/v1/me/organizations`
- `GET /api/v1/me/backup`
- `POST /api/v1/me/restore`
- `POST /api/v1/organizations`
- `GET /api/v1/organizations/:handle`
- `GET /api/v1/organizations/:handle/members`
- `POST /api/v1/organizations/:handle/members`
- `GET /api/v1/reviewer/reports`
- `PATCH /api/v1/reviewer/reports/:id`
- `POST /api/v1/reviewer/reports/:id/assign`
- `POST /api/v1/reviewer/users/:handle/ban`
- `DELETE /api/v1/reviewer/users/:handle/ban`
- `DELETE /api/v1/reviewer/packages/:name`
- `POST /api/v1/reviewer/packages/:name/merge`
- `GET /api/v1/notifications`
- `PATCH /api/v1/notifications/:id/read`
- `POST /api/v1/import/github/preview`
- `POST /api/v1/import/github`
- `POST /api/v1/packages`
- `PATCH /api/v1/packages/:name/settings`
- `POST /api/v1/packages/:name/rename`
- `POST /api/v1/packages/:name/transfer`
- `DELETE /api/v1/packages/:name`
- `POST /api/v1/packages/:name/restore`
- `POST /api/v1/packages/:name/versions/:version/yank`

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
Rendered README/SKILL documentation is capped by `KOVAHUB_MAX_DOCUMENTATION_BYTES`. Report auto-hide defaults to 3 open reports and can be changed with `KOVAHUB_AUTO_HIDE_REPORT_THRESHOLD`.
Production rate limits are enabled automatically when `NODE_ENV=production`, or explicitly with `KOVAHUB_RATE_LIMIT_ENABLED=1`. Metrics are public unless `KOVAHUB_METRICS_TOKEN` is set.
Backup exports can be trimmed with `KOVAHUB_BACKUP_RETENTION_DAYS`, `KOVAHUB_BACKUP_MAX_VERSIONS`, and `KOVAHUB_BACKUP_INCLUDE_ARCHIVES=false`.
Hosted scanner and signing hooks are optional: `KOVAHUB_SCANNER_WEBHOOK_URL` queues scanner metadata, while `KOVAHUB_PUBLISH_SIGNING_SECRET` and `KOVAHUB_PUBLISH_SIGNING_KEY_ID` generate registry publish receipt signatures.

## CLI

The first-party CLI package lives in `cli/` and uses the device-code flow:

```bash
pnpm --filter @kovahub/cli dev login --registry http://localhost:8787
pnpm --filter @kovahub/cli dev whoami --registry http://localhost:8787
pnpm --filter @kovahub/cli dev publish ./package-publish.json --archive ./my-package.zip --registry http://localhost:8787
pnpm --filter @kovahub/cli dev install @publisher/package --registry http://localhost:8787
pnpm --filter @kovahub/cli dev update @publisher/package --registry http://localhost:8787
pnpm --filter @kovahub/cli dev sync --registry http://localhost:8787
pnpm --filter @kovahub/cli dev pin @publisher/package 1.2.3
pnpm --filter @kovahub/cli dev unpin @publisher/package
pnpm --filter @kovahub/cli dev list
```

## Remaining Hardening

KovaHub now has the main ClawHub-style marketplace, publish, package detail, stars, dashboard, profile, search, comments, report, audit, registry, owner settings, organizations, CLI auth/install flows, import/export, moderation, documentation rendering, browser E2E coverage, Kova registry contract checks, and compatibility surfaces. Remaining hardening work is:

1. Run the Kova registry contract check against the deployed production URL after hosting is live.
2. Add a true native Kova CLI install smoke once the upstream Kova CLI exposes the KovaHub resolver in a stable command/test surface.

## References

- Kova reference repo: `/home/chirag/kova`
- ClawHub reference repo inspected from `https://github.com/openclaw/clawhub.git`

The Kova reference was used only for docs/contracts. ClawHub is MIT-licensed and was inspected only as a visual/product reference; this scaffold uses original KovaHub code and Kova package metadata.
