/**
 * Single place where sharp is imported and configured, so global settings apply everywhere.
 */
import sharp from "sharp";

// libvips keeps opened file handles in a cache by default. On Windows that locks source and temp files
// (unlink/rename fails with EBUSY). Disable only the FILE-HANDLE cache; memory/operation caches keep defaults.
sharp.cache({ files: 0 });

export { sharp };
