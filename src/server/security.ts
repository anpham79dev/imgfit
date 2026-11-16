import { randomBytes, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { ImgfitError } from "../core/errors.js";

export const COOKIE_NAME = "imgfit_sid";
export const CSRF_HEADER = "x-imgfit-csrf";

export interface Secrets {
  /** One-time token in the URL printed to the terminal; exchanged for a cookie on first open. */
  bootstrap: string | null;
  /** Session cookie value (HttpOnly; SameSite=Strict). */
  session: string;
}

export function newSecrets(): Secrets {
  return { bootstrap: randomBytes(24).toString("base64url"), session: randomBytes(32).toString("base64url") };
}

export function safeEqual(a: string | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

/**
 * Protection layers for the loopback server (docs/plan.md §5.3):
 * 1. Host allowlist → defeats DNS rebinding.
 * 2. One-time bootstrap token → HttpOnly SameSite=Strict cookie (the token never lingers in URLs/logs).
 * 3. Every request needs the session cookie.
 * 4. State-changing requests need a same-origin Origin + a custom CSRF header (forces preflight; CORS is off).
 * 5. Security headers (CSP, nosniff, frame deny, no-referrer).
 */
export function securityMiddleware(getPort: () => number, secrets: Secrets) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const port = getPort();
    const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
    const allowedOrigins = new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`]);

    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );

    if (!allowedHosts.has(req.headers.host ?? "")) {
      res.status(403).json({ errors: [{ code: "E_FORBIDDEN", message: "Host không được phép" }] });
      return;
    }

    // Bootstrap: /?t=<token> → set cookie, strip the token from the URL, invalidate the token
    const t = typeof req.query.t === "string" ? req.query.t : undefined;
    if (req.method === "GET" && req.path === "/" && t !== undefined) {
      if (!safeEqual(t, secrets.bootstrap)) {
        res.status(401).type("text/plain; charset=utf-8").send("Token không hợp lệ hoặc đã được dùng. Mở lại đúng URL in trong terminal, hoặc khởi động lại imgfit ui.");
        return;
      }
      secrets.bootstrap = null;
      res.setHeader("Set-Cookie", `${COOKIE_NAME}=${encodeURIComponent(secrets.session)}; HttpOnly; SameSite=Strict; Path=/`);
      res.redirect(303, "/");
      return;
    }

    if (!safeEqual(readCookie(req, COOKIE_NAME), secrets.session)) {
      if (req.path.startsWith("/api/")) res.status(401).json({ errors: [{ code: "E_FORBIDDEN", message: "Thiếu hoặc sai phiên. Mở URL có token in trong terminal." }] });
      else res.status(401).type("text/plain; charset=utf-8").send("imgfit ui: mở đúng URL (có token) được in trong terminal.");
      return;
    }

    const mutating = !["GET", "HEAD", "OPTIONS"].includes(req.method);
    if (req.method === "OPTIONS") {
      res.status(403).end(); // CORS is off: never answer preflights
      return;
    }
    if (mutating) {
      const origin = req.headers.origin;
      const site = req.headers["sec-fetch-site"];
      const originOk = origin ? allowedOrigins.has(origin) : site === "same-origin";
      if (!originOk || req.headers[CSRF_HEADER] !== "1") {
        res.status(403).json({ errors: [{ code: "E_FORBIDDEN", message: "Request ghi bị chặn (Origin/CSRF không hợp lệ)" }] });
        return;
      }
    }
    next();
  };
}

export function httpStatusFor(code: string): number {
  switch (code) {
    case "E_USAGE":
    case "E_CONFIG_INVALID":
    case "E_CONFIG_NOT_FOUND":
    case "E_FORMAT_NOT_ALLOWED":
    case "E_INPUT_UNSUPPORTED":
    case "E_INPUT_CORRUPT":
    case "E_INPUT_ANIMATED":
    case "E_INPUT_TOO_LARGE":
    case "E_SMALL_INPUT":
    case "E_FORMAT_UNSUPPORTED":
      return 400;
    case "E_FORBIDDEN":
    case "E_PATH_UNSAFE":
      return 403;
    case "E_NOT_FOUND":
    case "E_INPUT_NOT_FOUND":
      return 404;
    case "E_OUTPUT_CONFLICT":
      return 409;
    case "E_DISK_FULL":
      return 507;
    default:
      return 500;
  }
}

export const notFound = (what: string) => new ImgfitError("E_NOT_FOUND", `${what} không tồn tại`);
