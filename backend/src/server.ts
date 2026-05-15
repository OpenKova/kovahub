import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import Fastify from "fastify";
import { registerAuthRoutes } from "./auth.js";
import { createPostgresRegistryRepository } from "./postgresRepository.js";
import { InMemoryRegistryRepository, type RegistryRepository } from "./repository.js";
import { registerRegistryRoutes } from "./routes.js";

async function createDefaultRepository(): Promise<RegistryRepository> {
  if (process.env.DATABASE_URL) return createPostgresRegistryRepository();
  return new InMemoryRegistryRepository();
}

export async function buildServer(repo?: RegistryRepository) {
  const activeRepo = repo ?? (await createDefaultRepository());
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
    },
  });

  await app.register(cors, {
    origin: true,
    credentials: true,
    methods: ["GET", "POST", "OPTIONS"],
  });

  await app.register(multipart, {
    limits: {
      files: 1,
      fields: 32,
      fileSize: Number.parseInt(process.env.KOVAHUB_MAX_ARCHIVE_BYTES ?? `${25 * 1024 * 1024}`, 10),
    },
  });

  await registerAuthRoutes(app, activeRepo);
  await registerRegistryRoutes(app, activeRepo);

  app.addHook("onClose", async () => {
    await activeRepo.close?.();
  });

  app.setErrorHandler((error, _request, reply) => {
    app.log.error(error);
    reply.code(500).send({ error: "Internal server error." });
  });

  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const host = process.env.KOVAHUB_API_HOST ?? "0.0.0.0";
  const port = Number.parseInt(process.env.KOVAHUB_API_PORT ?? "8787", 10);
  const app = await buildServer();
  await app.listen({ host, port });
}
