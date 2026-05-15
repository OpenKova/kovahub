import cors from "@fastify/cors";
import Fastify from "fastify";
import { registerAuthRoutes } from "./auth.js";
import { InMemoryRegistryRepository, type RegistryRepository } from "./repository.js";
import { registerRegistryRoutes } from "./routes.js";

export async function buildServer(repo: RegistryRepository = new InMemoryRegistryRepository()) {
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

  await registerAuthRoutes(app, repo);
  await registerRegistryRoutes(app, repo);

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
