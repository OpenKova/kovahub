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
