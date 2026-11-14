/**
 * Node API của imgfit. Dùng chung core với CLI; các ngôn ngữ khác dùng CLI + JSON (xem README).
 *
 * @example
 * import { resize } from "imgfit";
 * const report = await resize({ inputs: ["raw/"], output: "out", width: 256, height: 256, mode: "cover", format: "webp" });
 * if (report.status !== "ok") process.exitCode = 1;
 */
export { resize, validateResizeOptions, DEFAULT_JOBS, DEFAULT_NAME_TEMPLATE } from "./commands/resize.js";
export type { ResizeOptions, ProgressEvent, ProgressEventType } from "./commands/resize.js";
export { info, capabilities } from "./commands/info.js";
export type { ImageInfo, Capabilities } from "./commands/info.js";
export { probe, planTransform, transformToFile, parseColor, DEFAULT_QUALITY } from "./core/process.js";
export type { TransformOptions, TransformPlan, ProbeResult } from "./core/process.js";
export type { Mode, SmallInputPolicy, CropPosition, Point, Size } from "./core/geometry.js";
export type { OutputFormat, FormatOption } from "./core/formats.js";
export type { OnConflict } from "./core/output.js";
export { ImgfitError, ERROR_CODES, WARNING_CODES } from "./core/errors.js";
export type { ErrorCode, WarningCode, Issue } from "./core/errors.js";
export { RESULT_SCHEMA_VERSION } from "./core/report.js";
export type { Report, FileResult, FileStatus, RunStatus, Summary } from "./core/report.js";
export { exitCodeFor, EXIT } from "./core/exit.js";
export { versions, TOOL_VERSION } from "./version.js";
