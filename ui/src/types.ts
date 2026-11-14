import type { FileResult, Issue, Point, Report } from "./api";

/** GET /api/v1/project */
export interface ProjectInfo {
  configured: boolean;
  root: string;
  error?: Issue;
  profile?: string;
  inputRoot?: string;
  outputRoot?: string;
  presets?: Record<string, { width: number; height: number; mode: string }>;
  rules?: Array<{ id: string; presets: string[]; to: string; names: string | null }>;
  warnings?: Issue[];
}

/** A manifest row: a FileResult plus the source info the UI needs. */
export type ManifestItem = FileResult & { sourceRel: string; focal: Point | null; mode: string | null };

export type ProjectReport = Omit<Report, "files"> & { files: ManifestItem[] };

export interface PreviewResult {
  url: string;
  bytes: number;
  width: number;
  height: number;
  inputBytes?: number | null;
  warnings: Issue[];
}
