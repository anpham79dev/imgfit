import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { Request, Response } from "express";
import multer from "multer";
import { LIMITS, newId, type SessionStore } from "./sessions.js";

/**
 * Multipart parser writing into the session's private "incoming" directory under random names.
 * Size/count limits are enforced while streaming; content is validated afterwards (SessionStore.accept).
 */
export function createUploader(sessions: SessionStore): (req: Request, res: Response) => Promise<Express.Multer.File[]> {
  const upload = multer({
    storage: multer.diskStorage({
      destination: (req, _file, cb) => {
        try {
          const dir = path.join(sessions.get(req.params.id as string).dir, "incoming");
          mkdir(dir, { recursive: true, mode: 0o700 }).then(
            () => cb(null, dir),
            (e: Error) => cb(e, dir),
          );
        } catch (e) {
          cb(e as Error, "");
        }
      },
      filename: (_req, _file, cb) => cb(null, newId(12)),
    }),
    limits: { fileSize: LIMITS.fileBytes, files: LIMITS.filesPerRequest, fields: 10, parts: LIMITS.filesPerRequest + 10 },
    // browsers send UTF-8 filenames without a charset parameter
    defParamCharset: "utf8",
  }).array("files", LIMITS.filesPerRequest);

  return (req, res) =>
    new Promise((resolve, reject) =>
      upload(req, res, (err: unknown) => (err ? reject(err) : resolve((req.files as Express.Multer.File[] | undefined) ?? []))),
    );
}
