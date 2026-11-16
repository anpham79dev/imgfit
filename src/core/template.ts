import { ImgfitError } from "./errors.js";
import { sanitizeSegment } from "./paths.js";

/** Placeholders allowed in output name templates. This list is a public contract. */
export const PLACEHOLDERS = ["name", "ext", "w", "h", "preset", "dir", "hash"] as const;

/** {hash} is left in the rendered path as this token and resolved after encoding (pipeline/content-name.ts). */
export const HASH_TOKEN = "{hash}";
export type Placeholder = (typeof PLACEHOLDERS)[number];

export interface TemplateVars {
  /** source basename without extension (not yet sanitised) */
  name: string;
  ext: string;
  w: number;
  h: number;
  preset?: string;
  /** relative sub-directory (posix, may be empty) */
  dir: string;
  /** content hash; normally absent so the token is kept until the output exists */
  hash?: string;
}

const TOKEN = /\{([^{}]*)\}/g;
const DIR_MARK = "\u0000DIR\u0000";

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
  const segments = template.split(/[/\\]/);
  if (segments.slice(0, -1).some((seg) => seg.includes(HASH_TOKEN))) {
    throw new ImgfitError("E_USAGE", `{hash} chỉ được dùng trong tên file (phần cuối), không trong thư mục: "${template}"`);
  }
}

function placeholderValue(key: Placeholder, vars: TemplateVars): string {
  switch (key) {
    case "name":
      // braces are replaced so a source name can never fake the {hash} token
      return sanitizeSegment(vars.name).replace(/[/{}]/g, "_");
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
      return DIR_MARK; // expanded per segment below
    case "hash":
      return vars.hash ?? HASH_TOKEN;
  }
}

/**
 * Renders a template into a relative posix path. Every segment is sanitised;
 * `{dir}` is the only placeholder that may produce "/", and each of its parts is sanitised too.
 */
export function renderTemplate(template: string, vars: TemplateVars): string {
  validateTemplate(template);
  const rendered = template.replace(TOKEN, (_all, key: string) => placeholderValue(key as Placeholder, vars));

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
