import { existsSync } from "node:fs";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { createServerContext } from "./context.js";
import { errorHandler } from "./http.js";
import { batchRoutes } from "./routes/batches.js";
import { projectRoutes } from "./routes/project.js";
import { sessionRoutes } from "./routes/sessions.js";
import { systemRoutes } from "./routes/system.js";
import { writeRoutes } from "./routes/write.js";
import { newSecrets, notFound, securityMiddleware } from "./security.js";

export interface UiServerOptions {
  /** Project root. With imgfit.json → project mode; without → quick resize only. */
  root?: string;
  /** 0 = random port. */
  port?: number;
  /** Built UI directory (default: dist/ui next to the server). */
  uiDir?: string;
  env?: NodeJS.ProcessEnv;
}

export interface UiServer {
  /** URL with the one-time token — printed for the user to open. */
  url: string;
  origin: string;
  port: number;
  close: () => Promise<void>;
  /** test-only access to the secrets */
  _secrets: { bootstrap: string | null; session: string };
}

/** dist/server → dist/ui (build), src/server → dist/ui (tests/dev). */
function findUiDir(): string | undefined {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return [path.resolve(here, "../ui"), path.resolve(here, "../../dist/ui")].find((d) => existsSync(path.join(d, "index.html")));
}

/** Starts the loopback-only UI server. Security layers are documented in security.ts. */
export async function startUiServer(opts: UiServerOptions = {}): Promise<UiServer> {
  const ctx = await createServerContext(path.resolve(opts.root ?? process.cwd()), opts.env);
  const secrets = newSecrets();
  const uiDir = opts.uiDir ?? findUiDir();
  let port = opts.port ?? 0;

  const app = express();
  app.disable("x-powered-by");
  app.set("etag", false);
  app.use(securityMiddleware(() => port, secrets));
  app.use(express.json({ limit: "2mb" }));

  const api = express.Router();
  api.use(systemRoutes(ctx), sessionRoutes(ctx), batchRoutes(ctx), projectRoutes(ctx), writeRoutes(ctx));
  app.use("/api/v1", api);
  app.use("/api", (_req, _res, next) => next(notFound("API")));

  if (uiDir) app.use(express.static(uiDir, { index: "index.html", maxAge: 0 }));
  else app.get("/", (_req, res) => void res.type("text/plain; charset=utf-8").send("imgfit ui: chưa có bản build UI (chạy npm run build:ui). API vẫn hoạt động ở /api/v1."));
  app.use(errorHandler);

  const server = app.listen(port, "127.0.0.1"); // never 0.0.0.0
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  port = (server.address() as AddressInfo).port;
  const sweeper = setInterval(() => void ctx.sessions.sweep(), 10 * 60 * 1000);
  sweeper.unref();

  const origin = `http://127.0.0.1:${port}`;
  return {
    url: `${origin}/?t=${secrets.bootstrap}`,
    origin,
    port,
    _secrets: secrets,
    close: async () => {
      clearInterval(sweeper);
      ctx.batches.cancelAll();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await ctx.sessions.destroy();
    },
  };
}
