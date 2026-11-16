/**
 * Option groups shared by several commands, so names and help texts stay consistent.
 */
import type { Command } from "commander";
import { ImgfitError } from "../core/errors.js";
import type { OnConflict } from "../io/publish.js";
import type { Opts } from "./context.js";

/** --json, --report-json, --quiet, --verbose */
export function withOutputOptions(cmd: Command): Command {
  return cmd
    .option("--json", "stdout chỉ chứa JSON report; log ghi stderr", false)
    .option("--report-json <file>", "ghi thêm JSON report ra file")
    .option("--quiet", "chỉ in lỗi và tổng kết", false)
    .option("--verbose", "in cả file không đổi, cảnh báo và version", false);
}

/** Maps --overwrite / --skip-existing to an onConflict policy (undefined = command default). */
export function conflictFrom(o: Opts): OnConflict | undefined {
  if (o.overwrite && o.skipExisting) throw new ImgfitError("E_USAGE", "Không dùng đồng thời --overwrite và --skip-existing");
  return o.overwrite ? "replace" : o.skipExisting ? "skip" : undefined;
}
