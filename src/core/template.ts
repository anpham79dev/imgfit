import { ImgfitError } from "./errors.js";
import { sanitizeSegment } from "./paths.js";

/** Placeholder được phép trong template tên output. Danh sách này là hợp đồng công khai. */
export const PLACEHOLDERS = ["name", "ext", "w", "h", "preset", "dir"] as const;
export type Placeholder = (typeof PLACEHOLDERS)[number];

export interface TemplateVars {
  /** basename nguồn không đuôi (chưa sanitize) */
  name: string;
  ext: string;
  w: number;
  h: number;
  preset?: string;
  /** thư mục con tương đối (dạng posix, có thể rỗng) */
  dir: string;
}

const TOKEN = /\{([^{}]*)\}/g;

export function validateTemplate(template: string): void {
  if (template.trim() === "") throw new ImgfitError("E_USAGE", "Template tên output rỗng");
  if (/^[/\\]/.test(template) || /^[a-zA-Z]:/.test(template)) {
    throw new ImgfitError("E_USAGE", `Template tên output không được là đường dẫn tuyệt đối: "${template}"`);
  }
  for (const m of template.matchAll(TOKEN)) {
    const key = m[1] ?? "";
    if (!(PLACEHOLDERS as readonly string[]).includes(key)) {
      throw new ImgfitError("E_USAGE", `Placeholder không hợp lệ "{${key}}". Cho phép: ${PLACEHOLDERS.map((p) => `{${p}}`).join(", ")}`);
    }
  }
  const stripped = template.replace(TOKEN, "x");
  if (/[{}]/.test(stripped)) throw new ImgfitError("E_USAGE", `Template có dấu ngoặc không cân: "${template}"`);
  for (const seg of stripped.split(/[/\\]/)) {
    if (seg === "..") throw new ImgfitError("E_USAGE", `Template không được chứa "..": "${template}"`);
  }
}

/**
 * Render template thành đường dẫn tương đối dạng posix. Mỗi segment đều được sanitize;
 * `{dir}` là placeholder duy nhất được sinh ra dấu "/", và từng phần của nó cũng được sanitize.
 */
export function renderTemplate(template: string, vars: TemplateVars): string {
  validateTemplate(template);
  const DIR_MARK = "\u0000DIR\u0000";
  const rendered = template.replace(TOKEN, (_all, key: string) => {
    switch (key as Placeholder) {
      case "name":
        return sanitizeSegment(vars.name).replace(/\//g, "_");
      case "ext":
        return vars.ext;
      case "w":
        return String(vars.w);
      case "h":
        return String(vars.h);
      case "preset":
        if (!vars.preset) throw new ImgfitError("E_USAGE", "Template dùng {preset} nhưng không có preset");
        return sanitizeSegment(vars.preset);
      case "dir":
        return DIR_MARK;
      default:
        return "";
    }
  });

  const dirSegments = vars.dir
    .split("/")
    .filter((s) => s !== "" && s !== ".")
    .map((s) => {
      if (s === "..") throw new ImgfitError("E_PATH_UNSAFE", `{dir} chứa ".."`);
      return sanitizeSegment(s);
    });

  const segments: string[] = [];
  for (const raw of rendered.split(/[/\\]/)) {
    if (raw === DIR_MARK) {
      segments.push(...dirSegments);
      continue;
    }
    const part = raw.includes(DIR_MARK) ? raw.replace(DIR_MARK, dirSegments.join("_")) : raw;
    if (part === "" || part === ".") continue;
    segments.push(sanitizeSegment(part));
  }
  if (segments.length === 0) throw new ImgfitError("E_USAGE", `Template sinh ra tên rỗng: "${template}"`);
  return segments.join("/");
}
