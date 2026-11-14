/**
 * Public Node API of imgfit — the same core the CLI uses. Other languages use the CLI + JSON (see README).
 *
 * @example
 * import { run, resize } from "imgfit";
 * const report = await run({ cwd: "path/to/project" });
 * if (report.status !== "ok") process.exitCode = 1;
 */

// commands
export { resize, validateResizeOptions, DEFAULT_JOBS, DEFAULT_NAME_TEMPLATE } from "./commands/resize.js";
export type { ResizeOptions } from "./commands/resize.js";
export { run } from "./commands/run.js";
export type { RunOptions } from "./commands/run.js";
export { check, validateOutput } from "./commands/check.js";
export type { CheckOptions, CheckMode } from "./commands/check.js";
export { init, sampleConfig } from "./commands/init.js";
export type { InitOptions, InitResult } from "./commands/init.js";
export { exec, parseExecSpec } from "./commands/exec.js";
export type { ExecSpec, ExecItem, ExecOptions } from "./commands/exec.js";
export { watch } from "./commands/watch.js";
export type { WatchOptions, WatchTrigger } from "./commands/watch.js";
export { info, capabilities } from "./commands/info.js";
export type { ImageInfo, Capabilities } from "./commands/info.js";

// project
export { openProject } from "./project/open.js";
export type { ProjectOptions } from "./project/open.js";
export { loadConfig, validateConfigShape } from "./project/config/load.js";
export { findConfig } from "./project/config/find.js";
export { PROFILE_FORMATS } from "./project/config/types.js";
export type { ConfigFile, PresetConfig, RuleConfig, ProjectConfig, Profile } from "./project/config/types.js";
export { buildManifest } from "./project/manifest.js";

// image engine
export { probe } from "./image/probe.js";
export type { ProbeResult } from "./image/probe.js";
export { planTransform } from "./image/plan.js";
export type { TransformPlan } from "./image/plan.js";
export { transformToFile } from "./image/encode.js";
export { parseColor, DEFAULT_QUALITY } from "./image/options.js";
export type { TransformOptions } from "./image/options.js";
export type { Mode, SmallInputPolicy, CropPosition, Point, Size } from "./image/geometry.js";
export type { OutputFormat, FormatOption } from "./image/formats.js";
export type { OnConflict } from "./io/publish.js";
export type { ProgressEvent, ProgressEventType } from "./pipeline/batch.js";

// contracts
export { ImgfitError, ERROR_CODES, WARNING_CODES } from "./core/errors.js";
export type { ErrorCode, WarningCode, Issue } from "./core/errors.js";
export { RESULT_SCHEMA_VERSION } from "./core/report.js";
export type { Report, FileResult, FileStatus, RunStatus, Summary } from "./core/report.js";
export { exitCodeFor, EXIT } from "./core/exit.js";
export { versions, TOOL_VERSION } from "./version.js";
