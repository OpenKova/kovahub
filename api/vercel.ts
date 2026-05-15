import type { IncomingMessage, ServerResponse } from "node:http";
import { buildServer } from "../backend/src/server.ts";

let appPromise: ReturnType<typeof buildServer> | undefined;

async function getApp() {
  if (!appPromise) {
    appPromise = buildServer().then(async (app) => {
      await app.ready();
      return app;
    });
  }

  try {
    return await appPromise;
  } catch (error) {
    appPromise = undefined;
    throw error;
  }
}

function rewriteRequestUrl(request: IncomingMessage) {
  const current = new URL(request.url ?? "/", "https://kovahub.local");
  const targetPath = current.searchParams.get("__kovahub_path");
  if (!targetPath) return;

  current.searchParams.delete("__kovahub_path");
  const query = current.searchParams.toString();
  request.url = `${targetPath}${query ? `?${query}` : ""}`;
}

export default async function handler(request: IncomingMessage, response: ServerResponse) {
  try {
    rewriteRequestUrl(request);
    const app = await getApp();
    await new Promise<void>((resolve, reject) => {
      response.once("finish", resolve);
      response.once("error", reject);
      app.server.emit("request", request, response);
    });
  } catch (error) {
    console.error(error);
    if (!response.headersSent) {
      response.statusCode = 500;
      response.setHeader("content-type", "application/json; charset=utf-8");
    }
    if (!response.writableEnded) response.end(JSON.stringify({ error: "Internal server error." }));
  }
}
