import fastifyJwt from "@fastify/jwt";
import bcrypt from "bcryptjs";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AuthPrincipal, RegistryRepository } from "./repository.js";

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

function publicUser(user: AuthPrincipal) {
  return {
    id: user.id,
    handle: user.handle,
    email: user.email,
  };
}

export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<AuthPrincipal | null> {
  try {
    return await request.jwtVerify<AuthPrincipal>();
  } catch {
    reply.code(401).send({ error: "Authentication required." });
    return null;
  }
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
    const user = await requireAuth(request, reply);
    if (!user) return reply;
    return { user: publicUser(user) };
  });
}
