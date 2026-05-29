import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { RegistryRepository } from "./repository.js";

type RateBucket = {
  count: number;
  resetAt: number;
};

type RequestMetrics = {
  startedAt: number;
  requests: number;
  responsesByStatus: Record<string, number>;
  rateLimited: number;
};

type RateLimitRule = {
  name: string;
  max: number;
  windowMs: number;
  matches: (request: FastifyRequest) => boolean;
};

const buckets = new Map<string, RateBucket>();

function intFromEnv(name: string, fallback: number) {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function rateLimitsEnabled() {
  if (process.env.KOVAHUB_RATE_LIMIT_ENABLED === "0") return false;
  if (process.env.KOVAHUB_RATE_LIMIT_ENABLED === "1") return true;
  return process.env.NODE_ENV === "production";
}

function clientKey(request: FastifyRequest) {
  const forwarded = request.headers["x-forwarded-for"];
  const firstForwarded = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  return firstForwarded?.split(",")[0]?.trim() || request.ip || "unknown";
}

function requestPath(request: FastifyRequest) {
  return request.url.split("?")[0] ?? request.url;
}

function writePath(request: FastifyRequest) {
  if (!["POST", "PATCH", "DELETE"].includes(request.method)) return false;
  const path = requestPath(request);
  return (
    path.startsWith("/api/v1/packages") ||
    path.startsWith("/api/v1/import/") ||
    path.startsWith("/api/v1/me/restore") ||
    path.includes("/report")
  );
}

function createRateLimitRules(): RateLimitRule[] {
  const globalWindowMs = intFromEnv("KOVAHUB_RATE_LIMIT_WINDOW_MS", 60_000);
  return [
    {
      name: "auth",
      max: intFromEnv("KOVAHUB_AUTH_RATE_LIMIT_MAX", 60),
      windowMs: intFromEnv("KOVAHUB_AUTH_RATE_LIMIT_WINDOW_MS", 10 * 60_000),
      matches: (request: FastifyRequest) => requestPath(request).startsWith("/api/v1/auth/"),
    },
    {
      name: "write",
      max: intFromEnv("KOVAHUB_WRITE_RATE_LIMIT_MAX", 60),
      windowMs: intFromEnv("KOVAHUB_WRITE_RATE_LIMIT_WINDOW_MS", 60 * 60_000),
      matches: writePath,
    },
    {
      name: "global",
      max: intFromEnv("KOVAHUB_RATE_LIMIT_MAX", 600),
      windowMs: globalWindowMs,
      matches: (request: FastifyRequest) => !["/healthz", "/readyz", "/metrics"].includes(requestPath(request)),
    },
  ].filter((rule) => rule.max > 0 && rule.windowMs > 0);
}

function rateLimitRequest(request: FastifyRequest, reply: FastifyReply, rules: RateLimitRule[], now: number) {
  for (const rule of rules) {
    if (!rule.matches(request)) continue;
    const key = `${rule.name}:${clientKey(request)}`;
    const current = buckets.get(key);
    const bucket = current && current.resetAt > now ? current : { count: 0, resetAt: now + rule.windowMs };
    bucket.count += 1;
    buckets.set(key, bucket);
    if (bucket.count <= rule.max) continue;

    const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    reply
      .code(429)
      .header("retry-after", String(retryAfterSeconds))
      .send({
        error: "Rate limit exceeded.",
        rateLimit: {
          scope: rule.name,
          limit: rule.max,
          retryAfter: retryAfterSeconds,
        },
      });
    return true;
  }
  return false;
}

function metricsTokenConfigured() {
  return Boolean(process.env.KOVAHUB_METRICS_TOKEN);
}

function hasMetricsAccess(request: FastifyRequest) {
  const configured = process.env.KOVAHUB_METRICS_TOKEN;
  if (!configured) return true;
  const authorization = request.headers.authorization;
  return authorization === `Bearer ${configured}`;
}

function snapshot(metrics: RequestMetrics) {
  const memory = process.memoryUsage();
  return {
    status: "ok",
    startedAt: metrics.startedAt,
    uptimeSeconds: Math.round(process.uptime()),
    requests: metrics.requests,
    responsesByStatus: metrics.responsesByStatus,
    rateLimited: metrics.rateLimited,
    memory: {
      rss: memory.rss,
      heapUsed: memory.heapUsed,
      heapTotal: memory.heapTotal,
    },
    rateLimits: {
      enabled: rateLimitsEnabled(),
      buckets: buckets.size,
    },
  };
}

function prometheus(metrics: RequestMetrics) {
  const statusLines = Object.entries(metrics.responsesByStatus)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([status, count]) => `kovahub_http_responses_total{status_class="${status}"} ${count}`);
  return [
    "# HELP kovahub_uptime_seconds Process uptime in seconds.",
    "# TYPE kovahub_uptime_seconds gauge",
    `kovahub_uptime_seconds ${Math.round(process.uptime())}`,
    "# HELP kovahub_http_requests_total Total HTTP requests seen by the API.",
    "# TYPE kovahub_http_requests_total counter",
    `kovahub_http_requests_total ${metrics.requests}`,
    "# HELP kovahub_http_responses_total HTTP responses grouped by status class.",
    "# TYPE kovahub_http_responses_total counter",
    ...statusLines,
    "# HELP kovahub_rate_limited_total Requests rejected by the built-in rate limiter.",
    "# TYPE kovahub_rate_limited_total counter",
    `kovahub_rate_limited_total ${metrics.rateLimited}`,
    "",
  ].join("\n");
}

export function registerOperationalRoutes(app: FastifyInstance, repo: RegistryRepository) {
  const metrics: RequestMetrics = {
    startedAt: Date.now(),
    requests: 0,
    responsesByStatus: {},
    rateLimited: 0,
  };
  const rules = createRateLimitRules();

  app.addHook("onRequest", async (request, reply) => {
    if (!rateLimitsEnabled() || request.method === "OPTIONS") return;
    const limited = rateLimitRequest(request, reply, rules, Date.now());
    if (limited) metrics.rateLimited += 1;
  });

  app.addHook("onResponse", async (_request, reply) => {
    metrics.requests += 1;
    const statusClass = `${Math.floor(reply.statusCode / 100)}xx`;
    metrics.responsesByStatus[statusClass] = (metrics.responsesByStatus[statusClass] ?? 0) + 1;
  });

  app.get("/healthz", async () => ({
    ok: true,
    status: "ok",
    service: "kovahub",
    uptimeSeconds: Math.round(process.uptime()),
  }));

  app.get("/readyz", async (_request, reply) => {
    try {
      await repo.listPackages({ limit: 1 });
      return { status: "ready", repository: "ok" };
    } catch (error) {
      reply.code(503);
      return {
        status: "not-ready",
        repository: error instanceof Error ? error.message : "Repository check failed.",
      };
    }
  });

  app.get("/api/v1/status", async () => ({
    service: "kovahub-api",
    status: "ok",
    storage: process.env.KOVAHUB_ARCHIVE_STORAGE ?? "local",
    database: process.env.DATABASE_URL ? "postgres" : "memory",
    metricsProtected: metricsTokenConfigured(),
    rateLimitsEnabled: rateLimitsEnabled(),
  }));

  app.get("/api/v1/ops/metrics", async (request, reply) => {
    if (!hasMetricsAccess(request)) {
      reply.code(401);
      return { error: "Metrics token required." };
    }
    return snapshot(metrics);
  });

  app.get("/metrics", async (request, reply) => {
    if (!hasMetricsAccess(request)) {
      reply.code(401);
      return "Metrics token required.\n";
    }
    reply.type("text/plain; version=0.0.4; charset=utf-8");
    return prometheus(metrics);
  });
}
