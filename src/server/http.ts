import type { NextFunction, Request, Response } from "express";
import { DEFAULT_NAME_TEMPLATE } from "../commands/resize.js";
import { ImgfitError, normalizeError } from "../core/errors.js";
import { validateTemplate } from "../core/template.js";
import type { Point } from "../image/geometry.js";
import { type TransformOptions, validateTransformOptions } from "../image/options.js";
import { httpStatusFor } from "./security.js";
import { LIMITS } from "./sessions.js";

type Handler = (req: Request, res: Response) => Promise<void> | void;

/** Wraps an async handler so rejections reach the error middleware. */
export const route =
  (fn: Handler) =>
  (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res)).catch(next);
  };

export function isPoint(v: unknown): v is Point {
  return !!v && typeof v === "object" && [(v as Point).x, (v as Point).y].every((n) => typeof n === "number" && n >= 0 && n <= 1);
}

export const body = <T>(req: Request): Partial<T> => (req.body ?? {}) as Partial<T>;

/** TransformOptions from a request body: only known keys are taken, then everything is validated. */
export function parseTransform(input: unknown): TransformOptions & { name: string } {
  const b = (input ?? {}) as Record<string, unknown>;
  const pick = (k: string) => (b[k] !== undefined && b[k] !== null && b[k] !== "" ? { [k]: b[k] } : {});
  const t = {
    width: Number(b.width),
    height: Number(b.height),
    mode: (b.mode ?? "fit") as TransformOptions["mode"],
    format: (b.format ?? "keep") as TransformOptions["format"],
    ...pick("quality"),
    ...pick("position"),
    ...pick("background"),
    ...pick("smallInput"),
    ...pick("upscale"),
    ...pick("sharpen"),
    ...pick("stripMetadata"),
    ...(b.png && typeof b.png === "object" ? { png: b.png as TransformOptions["png"] } : {}),
  } as TransformOptions;
  if (t.position === "focal") delete t.position; // focal points are per file
  validateTransformOptions(t);
  const name = typeof b.name === "string" && b.name.trim() ? b.name : DEFAULT_NAME_TEMPLATE;
  validateTemplate(name);
  return { ...t, name };
}

/** Last middleware: every error becomes `{ errors: [Issue] }` with a status derived from its code. */
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (res.headersSent) {
    res.end();
    return;
  }
  let e = normalizeError(err);
  const code = (err as { code?: string })?.code;
  if (typeof code === "string" && code.startsWith("LIMIT_")) {
    // multer limit errors
    e = new ImgfitError("E_USAGE", `Upload vượt giới hạn (${code}): tối đa ${LIMITS.fileBytes / 1024 / 1024} MB/file, ${LIMITS.filesPerRequest} file/lần`);
  }
  res.status(httpStatusFor(e.code)).json({ errors: [e.toIssue()] });
}
