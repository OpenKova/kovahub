import { createHash, randomBytes } from "node:crypto";
import fastifyJwt from "@fastify/jwt";
import bcrypt from "bcryptjs";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { ApiTokenRecord, AuthPrincipal, RegistryRepository } from "./repository.js";

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

const registerSchema = credentialsSchema.extend({
  handle: z
    .string()
    .trim()
    .min(2)
    .max(40)
    .regex(/^[a-z0-9][a-z0-9-]*$/i),
});

const apiTokenSchema = z.object({
  name: z.string().trim().min(1).max(80),
});

const apiTokenParamsSchema = z.object({
  id: z.string().min(1),
});

const githubStartSchema = z.object({
  returnTo: z.string().optional(),
});

const githubCallbackSchema = z.object({
  code: z.string().optional(),
  state: z.string().optional(),
  error: z.string().optional(),
  error_description: z.string().optional(),
});

const githubTokenResponseSchema = z
  .object({
    access_token: z.string().min(1).optional(),
    error: z.string().optional(),
    error_description: z.string().optional(),
  })
  .passthrough();

const githubUserSchema = z
  .object({
    id: z.number(),
    login: z.string().min(1),
    name: z.string().nullable().optional(),
    avatar_url: z.string().nullable().optional(),
    email: z.string().email().nullable().optional(),
  })
  .passthrough();

const githubEmailSchema = z
  .object({
    email: z.string().email(),
    primary: z.boolean(),
    verified: z.boolean(),
  })
  .passthrough();

const githubStateCookieName = "kovahub_github_state";
const githubAuthorizeUrl = "https://github.com/login/oauth/authorize";
const githubAccessTokenUrl = "https://github.com/login/oauth/access_token";
const githubUserUrl = "https://api.github.com/user";
const githubEmailsUrl = "https://api.github.com/user/emails";

function publicUser(user: AuthPrincipal) {
  return {
    id: user.id,
    handle: user.handle,
    email: user.email,
  };
}

function publicApiToken(token: ApiTokenRecord) {
  return {
    id: token.id,
    name: token.name,
    createdAt: token.createdAt,
    lastUsedAt: token.lastUsedAt,
  };
}

function createPlainApiToken() {
  return `khp_${randomBytes(32).toString("base64url")}`;
}

function hashApiToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function siteUrl() {
  return (process.env.KOVAHUB_SITE ?? process.env.KOVAHUB_SITE_URL ?? "http://localhost:5173").replace(/\/+$/, "");
}

function registryUrl() {
  return (process.env.KOVAHUB_REGISTRY ?? process.env.KOVAHUB_REGISTRY_URL ?? "http://localhost:8787").replace(
    /\/+$/,
    "",
  );
}

function githubCallbackUrl() {
  return process.env.GITHUB_CALLBACK_URL ?? `${registryUrl()}/api/v1/auth/github/callback`;
}

function githubClientConfig() {
  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

function safeReturnTo(value: string | null | undefined) {
  if (!value) return "/publish";
  return value.startsWith("/") && !value.startsWith("//") ? value : "/publish";
}

function encodeGitHubStateCookie(state: string, returnTo: string) {
  return `${state}.${Buffer.from(returnTo, "utf8").toString("base64url")}`;
}

function decodeGitHubStateCookie(value: string | null) {
  if (!value) return null;
  const [state, encodedReturnTo] = value.split(".");
  if (!state || !encodedReturnTo) return null;
  try {
    const returnTo = Buffer.from(encodedReturnTo, "base64url").toString("utf8");
    return { state, returnTo: safeReturnTo(returnTo) };
  } catch {
    return null;
  }
}

function readCookie(request: FastifyRequest, name: string) {
  const header = request.headers.cookie;
  if (!header) return null;
  const cookie = header
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  if (!cookie) return null;
  return decodeURIComponent(cookie.slice(name.length + 1));
}

function githubCookieAttributes(maxAge: number) {
  const secure = githubCallbackUrl().startsWith("https://") ? "; Secure" : "";
  return `Path=/api/v1/auth/github; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

function setGitHubStateCookie(reply: FastifyReply, value: string) {
  reply.header(
    "set-cookie",
    `${githubStateCookieName}=${encodeURIComponent(value)}; ${githubCookieAttributes(600)}`,
  );
}

function clearGitHubStateCookie(reply: FastifyReply) {
  reply.header("set-cookie", `${githubStateCookieName}=; ${githubCookieAttributes(0)}`);
}

function frontendAuthCallbackUrl(params: { token?: string; error?: string; returnTo?: string }) {
  const url = new URL("/auth/github/callback", siteUrl());
  url.searchParams.set("returnTo", safeReturnTo(params.returnTo));
  if (params.error) url.searchParams.set("error", params.error);
  if (params.token) {
    const hash = new URLSearchParams();
    hash.set("token", params.token);
    url.hash = hash.toString();
  }
  return url.toString();
}

function redirectToFrontendAuthCallback(
  reply: FastifyReply,
  params: { token?: string; error?: string; returnTo?: string },
) {
  return reply.redirect(frontendAuthCallbackUrl(params));
}

async function fetchGitHubAccessToken(
  code: string,
  config: { clientId: string; clientSecret: string },
) {
  const body = new URLSearchParams();
  body.set("client_id", config.clientId);
  body.set("client_secret", config.clientSecret);
  body.set("code", code);
  body.set("redirect_uri", githubCallbackUrl());

  const response = await fetch(githubAccessTokenUrl, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const parsed = githubTokenResponseSchema.parse(await response.json());
  if (!response.ok || !parsed.access_token) {
    throw new Error(parsed.error_description ?? parsed.error ?? "GitHub token exchange failed.");
  }
  return parsed.access_token;
}

async function fetchGitHubJson(url: string, accessToken: string) {
  const response = await fetch(url, {
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${accessToken}`,
    },
  });
  if (!response.ok) throw new Error(`GitHub request failed with HTTP ${response.status}.`);
  return response.json();
}

async function fetchGitHubProfile(accessToken: string) {
  const user = githubUserSchema.parse(await fetchGitHubJson(githubUserUrl, accessToken));
  let emails: Array<z.infer<typeof githubEmailSchema>> = [];
  try {
    const emailBody = await fetchGitHubJson(githubEmailsUrl, accessToken);
    emails = z.array(githubEmailSchema).parse(emailBody);
  } catch {
    emails = [];
  }

  const verifiedPrimary = emails.find((email) => email.primary && email.verified);
  const verified = emails.find((email) => email.verified);
  const email =
    verifiedPrimary?.email ??
    verified?.email ??
    user.email ??
    `github-${user.id}@users.noreply.kovahub.local`;

  return {
    githubId: String(user.id),
    login: user.login,
    email,
    displayName: user.name ?? user.login,
    imageUrl: user.avatar_url ?? null,
  };
}

function bearerToken(request: FastifyRequest) {
  const value = request.headers.authorization;
  if (!value) return null;
  const match = /^bearer\s+(.+)$/i.exec(value);
  return match?.[1]?.trim() ?? null;
}

async function verifyJwtPrincipal(request: FastifyRequest) {
  try {
    return await request.jwtVerify<AuthPrincipal>();
  } catch {
    return null;
  }
}

async function requireSessionAuth(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<AuthPrincipal | null> {
  const user = await verifyJwtPrincipal(request);
  if (user) return user;
  reply.code(401).send({ error: "Session authentication required." });
  return null;
}

export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply,
  repo: RegistryRepository,
): Promise<AuthPrincipal | null> {
  const jwtUser = await verifyJwtPrincipal(request);
  if (jwtUser) return jwtUser;

  const token = bearerToken(request);
  if (token?.startsWith("khp_")) {
    const user = await repo.findUserByApiTokenHash(hashApiToken(token));
    if (user) return user;
  }

  reply.code(401).send({ error: "Authentication required." });
  return null;
}

export async function registerAuthRoutes(app: FastifyInstance, repo: RegistryRepository) {
  await app.register(fastifyJwt, {
    secret: process.env.KOVAHUB_JWT_SECRET || "kovahub-dev-secret",
  });

  app.post("/api/v1/auth/register", async (request, reply) => {
    const parsed = registerSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: parsed.error.issues[0]?.message ?? "Invalid registration payload." };
    }

    const existingEmail = await repo.findUserByEmail(parsed.data.email);
    const existingHandle = await repo.findUserByHandle(parsed.data.handle);
    if (existingEmail || existingHandle) {
      reply.code(409);
      return { error: "Account already exists." };
    }

    const passwordHash = await bcrypt.hash(parsed.data.password, 12);
    const user = await repo.createUser({
      handle: parsed.data.handle,
      email: parsed.data.email,
      passwordHash,
    });
    const token = app.jwt.sign(publicUser(user), { sub: user.id });
    return { token, user: publicUser(user) };
  });

  app.post("/api/v1/auth/login", async (request, reply) => {
    const parsed = credentialsSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: parsed.error.issues[0]?.message ?? "Invalid login payload." };
    }

    const user = await repo.findUserByEmail(parsed.data.email);
    if (!user || !(await bcrypt.compare(parsed.data.password, user.passwordHash))) {
      reply.code(401);
      return { error: "Invalid email or password." };
    }

    const token = app.jwt.sign(publicUser(user), { sub: user.id });
    return { token, user: publicUser(user) };
  });

  app.get("/api/v1/auth/github/start", async (request, reply) => {
    const parsed = githubStartSchema.safeParse(request.query);
    const returnTo = safeReturnTo(parsed.success ? parsed.data.returnTo : undefined);
    const config = githubClientConfig();
    if (!config) {
      return redirectToFrontendAuthCallback(reply, {
        error: "GitHub OAuth is not configured.",
        returnTo,
      });
    }

    const state = randomBytes(24).toString("base64url");
    setGitHubStateCookie(reply, encodeGitHubStateCookie(state, returnTo));
    const authorize = new URL(githubAuthorizeUrl);
    authorize.searchParams.set("client_id", config.clientId);
    authorize.searchParams.set("redirect_uri", githubCallbackUrl());
    authorize.searchParams.set("scope", "read:user user:email");
    authorize.searchParams.set("state", state);
    return reply.redirect(authorize.toString());
  });

  app.get("/api/v1/auth/github/callback", async (request, reply) => {
    const parsed = githubCallbackSchema.safeParse(request.query);
    const stateCookie = decodeGitHubStateCookie(readCookie(request, githubStateCookieName));
    const returnTo = stateCookie?.returnTo ?? "/publish";
    clearGitHubStateCookie(reply);

    if (!parsed.success) {
      return redirectToFrontendAuthCallback(reply, { error: "Invalid GitHub callback.", returnTo });
    }
    if (parsed.data.error) {
      return redirectToFrontendAuthCallback(reply, {
        error: parsed.data.error_description ?? parsed.data.error,
        returnTo,
      });
    }
    if (!parsed.data.code || !parsed.data.state || !stateCookie || parsed.data.state !== stateCookie.state) {
      return redirectToFrontendAuthCallback(reply, {
        error: "GitHub sign-in state verification failed.",
        returnTo,
      });
    }

    const config = githubClientConfig();
    if (!config) {
      return redirectToFrontendAuthCallback(reply, {
        error: "GitHub OAuth is not configured.",
        returnTo,
      });
    }

    try {
      const accessToken = await fetchGitHubAccessToken(parsed.data.code, config);
      const profile = await fetchGitHubProfile(accessToken);
      const user = await repo.findOrCreateGitHubUser(profile);
      const token = app.jwt.sign(publicUser(user), { sub: user.id });
      return redirectToFrontendAuthCallback(reply, { token, returnTo });
    } catch (error) {
      const message = error instanceof Error ? error.message : "GitHub sign-in failed.";
      return redirectToFrontendAuthCallback(reply, { error: message, returnTo });
    }
  });

  app.get("/api/v1/auth/me", async (request, reply) => {
    const user = await requireAuth(request, reply, repo);
    if (!user) return reply;
    return { user: publicUser(user) };
  });

  app.get("/api/v1/auth/tokens", async (request, reply) => {
    const user = await requireSessionAuth(request, reply);
    if (!user) return reply;
    const tokens = await repo.listApiTokens(user.id);
    return { tokens: tokens.map(publicApiToken) };
  });

  app.post("/api/v1/auth/tokens", async (request, reply) => {
    const user = await requireSessionAuth(request, reply);
    if (!user) return reply;
    const parsed = apiTokenSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: parsed.error.issues[0]?.message ?? "Invalid API token payload." };
    }

    const token = createPlainApiToken();
    const apiToken = await repo.createApiToken({
      userId: user.id,
      name: parsed.data.name,
      tokenHash: hashApiToken(token),
    });
    reply.code(201);
    return { token, apiToken: publicApiToken(apiToken) };
  });

  app.delete("/api/v1/auth/tokens/:id", async (request, reply) => {
    const user = await requireSessionAuth(request, reply);
    if (!user) return reply;
    const parsed = apiTokenParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      reply.code(400);
      return { error: "Invalid API token id." };
    }

    const revoked = await repo.revokeApiToken({ userId: user.id, tokenId: parsed.data.id });
    if (!revoked) {
      reply.code(404);
      return { error: "API token not found." };
    }
    reply.code(204);
    return reply.send();
  });
}
