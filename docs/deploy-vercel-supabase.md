# Deploy KovaHub on Vercel + Supabase

This is the recommended free MVP deployment path:

- Vercel hosts the React frontend and the KovaHub API function.
- Supabase provides Postgres and S3-compatible Storage for package archives.
- GitHub OAuth provides the `Continue with GitHub` login.

## 1. Create Supabase Project

Create one Supabase project on the Free plan.

Copy the pooled Postgres connection string from Supabase:

```bash
DATABASE_URL=postgres://...
```

Use the pooled connection string if Supabase shows both direct and pooled options. Serverless functions open short-lived connections, so the pooler is the better default for Vercel.

## 2. Create Supabase Storage Bucket

Create a private bucket for package archives, for example:

```text
kovahub-archives
```

Then enable Supabase Storage S3 protocol access and generate S3 credentials in the Supabase Storage settings. Copy:

```bash
KOVAHUB_ARCHIVE_STORAGE=supabase
KOVAHUB_S3_ENDPOINT=https://project-ref.supabase.co/storage/v1/s3
KOVAHUB_S3_BUCKET=kovahub-archives
KOVAHUB_S3_REGION=your-supabase-region
KOVAHUB_S3_ACCESS_KEY_ID=...
KOVAHUB_S3_SECRET_ACCESS_KEY=...
KOVAHUB_S3_PREFIX=archives
```

Keep the S3 access key and secret only in Vercel environment variables. Do not put them in frontend code.

## 3. Create GitHub OAuth App

In GitHub:

```text
Settings -> Developer settings -> OAuth Apps -> New OAuth App
```

Use these values after the first Vercel deployment gives you a URL:

```text
Application name: KovaHub
Homepage URL: https://your-vercel-domain
Authorization callback URL: https://your-vercel-domain/api/v1/auth/github/callback
```

Copy the client ID and generate a client secret:

```bash
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
GITHUB_CALLBACK_URL=https://your-vercel-domain/api/v1/auth/github/callback
```

Do not enable GitHub Device Flow. KovaHub has its own CLI device-code auth flow.

## 4. Create Vercel Project

Import the GitHub repository into Vercel.

Use the repo root as the project root. The committed `vercel.json` sets:

```text
Install command: pnpm install --frozen-lockfile
Build command: pnpm build
Output directory: frontend/dist
```

Add these Vercel environment variables:

```bash
DATABASE_URL=postgres://...
KOVAHUB_ARCHIVE_STORAGE=supabase
KOVAHUB_S3_ENDPOINT=https://project-ref.supabase.co/storage/v1/s3
KOVAHUB_S3_BUCKET=kovahub-archives
KOVAHUB_S3_REGION=your-supabase-region
KOVAHUB_S3_ACCESS_KEY_ID=...
KOVAHUB_S3_SECRET_ACCESS_KEY=...
KOVAHUB_S3_PREFIX=archives

KOVAHUB_JWT_SECRET=generated-random-secret
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
GITHUB_CALLBACK_URL=https://your-vercel-domain/api/v1/auth/github/callback

KOVAHUB_SITE=https://your-vercel-domain
KOVAHUB_REGISTRY=https://your-vercel-domain
KOVAHUB_URL=https://your-vercel-domain
KOVA_KOVAHUB_URL=https://your-vercel-domain
VITE_KOVAHUB_API_URL=https://your-vercel-domain

KOVAHUB_REVIEWER_HANDLES=your-github-handle
```

Generate the JWT secret locally:

```bash
openssl rand -hex 32
```

## 5. Deploy

Push to `main`. Vercel should deploy automatically.

After deployment, check:

```text
https://your-vercel-domain/healthz
https://your-vercel-domain/openapi.json
https://your-vercel-domain/.well-known/kovahub.json
https://your-vercel-domain/api/v1/packages
```

Then try `Continue with GitHub`.

## Free Plan Notes

- Vercel Hobby is suitable for the MVP API and frontend while usage stays within Hobby limits.
- Supabase Free is suitable for early testing, but free projects can pause after inactivity.
- Package archives must use Supabase Storage on Vercel. Local archive storage is intentionally blocked on Vercel.
- If the project becomes a real public service with steady traffic, plan for paid database/storage/compute later.
