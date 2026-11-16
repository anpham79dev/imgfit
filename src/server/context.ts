import { existsSync } from "node:fs";
import path from "node:path";
import { ImgfitError } from "../core/errors.js";
import { loadConfig } from "../config/load.js";
import { CONFIG_FILENAME, type PresetConfigSet } from "../config/types.js";
import { BatchStore } from "./batches.js";
import { PreviewStore } from "./previews.js";
import { SessionStore } from "./sessions.js";

/** State shared by every route of one UI server instance. */
export interface ServerContext {
  root: string;
  configFile: string;
  sessions: SessionStore;
  batches: BatchStore;
  previews: PreviewStore;
  /** Presets from <root>/imgfit.json. */
  loadPresets(): Promise<PresetConfigSet>;
}

export async function createServerContext(root: string): Promise<ServerContext> {
  const sessions = await SessionStore.create();
  const configFile = path.join(root, CONFIG_FILENAME);
  return {
    root,
    configFile,
    sessions,
    batches: new BatchStore(),
    previews: await PreviewStore.create(sessions.base),
    loadPresets: async () => {
      if (!existsSync(configFile)) throw new ImgfitError("E_CONFIG_NOT_FOUND", `Không có ${CONFIG_FILENAME} trong ${root}`);
      return loadConfig(configFile);
    },
  };
}
