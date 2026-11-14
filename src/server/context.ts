import { existsSync } from "node:fs";
import path from "node:path";
import { ImgfitError } from "../core/errors.js";
import { loadConfig } from "../project/config/load.js";
import { CONFIG_FILENAME, type ProjectConfig } from "../project/config/types.js";
import { BatchStore } from "./batches.js";
import { PreviewStore } from "./previews.js";
import { SessionStore } from "./sessions.js";

export interface WriteConfirmation {
  /** hash of the reviewed write plan */
  hash: string;
  overwrite: boolean;
  expires: number;
}

/** State shared by every route of one UI server instance. */
export interface ServerContext {
  root: string;
  configFile: string;
  env: NodeJS.ProcessEnv | undefined;
  sessions: SessionStore;
  batches: BatchStore;
  previews: PreviewStore;
  /** single-use write confirmations (nonce → reviewed plan) */
  confirmations: Map<string, WriteConfirmation>;
  /**
   * destKey → sourceRel from the most recent manifest: the allowlist for output images/previews
   * (the API never accepts arbitrary paths).
   */
  knownDests: Map<string, string>;
  loadProject(): Promise<ProjectConfig>;
}

export async function createServerContext(root: string, env: NodeJS.ProcessEnv | undefined): Promise<ServerContext> {
  const sessions = await SessionStore.create();
  const configFile = path.join(root, CONFIG_FILENAME);
  return {
    root,
    configFile,
    env,
    sessions,
    batches: new BatchStore(),
    previews: await PreviewStore.create(sessions.base),
    confirmations: new Map(),
    knownDests: new Map(),
    loadProject: async () => {
      if (!existsSync(configFile)) throw new ImgfitError("E_CONFIG_NOT_FOUND", `Không có ${CONFIG_FILENAME} trong ${root}`);
      return loadConfig(configFile, env ? { env } : {});
    },
  };
}
