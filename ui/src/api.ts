/** API client: always same-origin, sends the session cookie and the CSRF header on writes. */

export interface Issue {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface FileResult {
  file: string;
  destination: string | null;
  status: string;
  action: string | null;
  rule: string | null;
  preset: string | null;
  format: string | null;
  inputBytes: number | null;
  outputBytes: number | null;
  inputPx: [number, number] | null;
  outputPx: [number, number] | null;
  elapsedMs: number;
  fingerprint: string | null;
  warnings: Issue[];
  errors: Issue[];
}

export interface Report {
  command: string;
  status: string;
  dryRun: boolean;
  summary: Record<string, number>;
  files: FileResult[];
  errors: Issue[];
  warnings: Issue[];
}

export interface Point {
  x: number;
  y: number;
}

export interface TransformForm {
  width: number;
  height: number;
  mode: "fit" | "cover" | "pad";
  format: "keep" | "jpg" | "png" | "webp" | "avif";
  quality?: number | null;
  position?: "center" | "top" | "attention";
  background?: string;
  smallInput?: "" | "error" | "keep" | "pad";
  upscale?: boolean;
  stripMetadata?: boolean;
  name?: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly issues: Issue[],
    readonly body: unknown,
  ) {
    super(issues.map((i) => `${i.code}: ${i.message}`).join("; ") || `HTTP ${status}`);
  }
}

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: "same-origin",
    headers: {
      ...(method !== "GET" ? { "X-Imgfit-CSRF": "1" } : {}),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : undefined;
  if (!res.ok) throw new ApiError(res.status, (data?.errors as Issue[]) ?? [], data);
  return data as T;
}

export const api = {
  get: <T>(url: string) => call<T>("GET", url),
  post: <T>(url: string, body?: unknown) => call<T>("POST", url, body ?? {}),
  put: <T>(url: string, body?: unknown) => call<T>("PUT", url, body ?? {}),
  del: <T>(url: string) => call<T>("DELETE", url),

  /** Multipart upload with progress (fetch has no upload progress). */
  upload<T>(url: string, files: File[], onProgress: (loaded: number, total: number) => void): Promise<T> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", url);
      xhr.withCredentials = true;
      xhr.setRequestHeader("X-Imgfit-CSRF", "1");
      xhr.upload.onprogress = (e) => onProgress(e.loaded, e.total);
      xhr.onload = () => {
        let data: unknown;
        try {
          data = JSON.parse(xhr.responseText);
        } catch {
          data = undefined;
        }
        if (xhr.status >= 200 && xhr.status < 300) resolve(data as T);
        else reject(new ApiError(xhr.status, ((data as { errors?: Issue[] })?.errors ?? []) as Issue[], data));
      };
      xhr.onerror = () => reject(new ApiError(0, [{ code: "E_NETWORK", message: "Mất kết nối tới imgfit ui" }], undefined));
      const form = new FormData();
      // the server only uses the basename; folder paths are never trusted
      for (const f of files) form.append("files", f, f.name);
      xhr.send(form);
    });
  },
};

/** Human-readable message for any error, including validation problems listed in details. */
export function errorMessage(e: unknown): string {
  if (!(e instanceof ApiError)) return String(e);
  return e.issues
    .map((i) => `${i.code}: ${i.message}${Array.isArray(i.details?.problems) ? ` — ${(i.details.problems as string[]).join("; ")}` : ""}`)
    .join("\n");
}

export function formatBytes(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  if (Math.abs(n) < 1024) return `${n} B`;
  if (Math.abs(n) < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export const px = (p: [number, number] | null | undefined) => (p ? `${p[0]}×${p[1]}` : "—");

export function saved(input: number | null, output: number | null): string {
  if (!input || output === null) return "";
  const pct = Math.round((1 - output / input) * 100);
  return pct >= 0 ? `−${pct}%` : `+${-pct}%`;
}

/** Drops empty fields before sending (the server validates strictly). */
export function cleanTransform(t: TransformForm): Record<string, unknown> {
  const out: Record<string, unknown> = { width: Number(t.width), height: Number(t.height), mode: t.mode, format: t.format };
  if (t.quality) out.quality = Number(t.quality);
  if (t.mode === "cover" && t.position) out.position = t.position;
  if (t.background) out.background = t.background;
  if (t.smallInput) out.smallInput = t.smallInput;
  if (t.upscale) out.upscale = true;
  if (t.stripMetadata === false) out.stripMetadata = false;
  if (t.name) out.name = t.name;
  return out;
}
