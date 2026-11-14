/**
 * The incremental decision for one manifest job: create / replace / unchanged / conflict / modified.
 * "Managed" is decided by imgfit.managed.json (committed), never by the deletable cache.
 */
import { lstat, stat } from "node:fs/promises";
import { ImgfitError, warning } from "../core/errors.js";
import type { OnConflict } from "../io/publish.js";
import type { ManifestJob } from "./manifest.js";
import type { CacheStore } from "./state/cache.js";
import type { ManagedStore } from "./state/managed.js";

export interface DecideContext {
  managed: ManagedStore;
  cache: CacheStore;
  onConflict: OnConflict;
}

async function exists(file: string): Promise<boolean> {
  return lstat(file).then(
    () => true,
    () => false,
  );
}

/** `run --adopt`: unmanaged outputs at rule destinations become candidates; nothing is encoded. */
export async function decideAdopt(j: ManifestJob, ctx: DecideContext): Promise<void> {
  const managed = ctx.managed.get(j.meta.destKey);
  if ((await exists(j.dest as string)) && !managed) j.result.action = "adopt";
  else j.result.status = managed ? "unchanged" : "skipped";
}

/** Sets `action` (create/replace) or a final status (unchanged/skipped) on the job, or throws a conflict. */
export async function decide(j: ManifestJob, fingerprint: string, ctx: DecideContext): Promise<void> {
  const r = j.result;
  const dest = j.dest as string;
  const entry = ctx.managed.get(j.meta.destKey);

  if (!(await exists(dest))) {
    r.action = "create";
    return;
  }

  if (entry) {
    const current = await ctx.cache.hashOf(j.meta.destKey, dest);
    if (current !== entry.hash) {
      if (ctx.onConflict === "replace") {
        r.action = "replace";
        r.warnings.push(warning("W_OUTPUT_MODIFIED", "Output đã bị sửa ngoài imgfit; thay theo --overwrite"));
        return;
      }
      throw new ImgfitError("E_OUTPUT_MODIFIED", `Output đã bị sửa ngoài imgfit: ${r.destination}. Dùng --overwrite để tạo lại (thêm --backup để giữ bản đang có)`, {
        destination: r.destination,
      });
    }
    if (entry.fingerprint === fingerprint) {
      r.status = "unchanged";
      r.outputBytes = (await stat(dest)).size;
      return;
    }
    r.action = "replace";
    return;
  }

  // the destination exists but imgfit does not own it
  switch (ctx.onConflict) {
    case "replace":
      r.action = "replace";
      return;
    case "skip":
      r.status = "skipped";
      r.warnings.push(warning("W_SKIP_EXISTING_UNVERIFIED", "Bỏ qua vì đích đã tồn tại; imgfit KHÔNG kiểm tra output cũ có đúng không"));
      return;
    default:
      throw new ImgfitError(
        "E_OUTPUT_CONFLICT",
        `Đích đã tồn tại nhưng chưa do imgfit quản lý: ${r.destination}. Chạy "imgfit run --adopt" để nhận quản lý, hoặc --overwrite để thay`,
        { destination: r.destination },
      );
  }
}
