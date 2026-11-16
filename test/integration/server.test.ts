import { readFile, stat, writeFile, mkdir } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startUiServer, type UiServer } from "../../src/server/app.js";
import { LIMITS } from "../../src/server/sessions.js";
import { solid, tempDir } from "../helpers.js";

let dir: string;
let cleanup: () => Promise<void>;
let server: UiServer;
let cookie = "";

interface Res {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
  json: () => any;
}

/** Raw HTTP (so Host/Origin can be set freely, which fetch does not allow). */
function req(method: string, url: string, opts: { headers?: Record<string, string>; body?: Buffer | string; host?: string } = {}): Promise<Res> {
  return new Promise((resolve, reject) => {
    const r = http.request(
      { host: "127.0.0.1", port: server.port, method, path: url, headers: { host: opts.host ?? `127.0.0.1:${server.port}`, ...(opts.headers ?? {}) } },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const body = Buffer.concat(chunks);
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body, json: () => JSON.parse(body.toString("utf8")) });
        });
      },
    );
    r.on("error", reject);
    if (opts.body !== undefined) r.write(opts.body);
    r.end();
  });
}

const origin = () => `http://127.0.0.1:${server.port}`;
const authed = (extra: Record<string, string> = {}) => ({ cookie, ...extra });
const writeHeaders = (extra: Record<string, string> = {}) => authed({ origin: origin(), "x-imgfit-csrf": "1", "content-type": "application/json", ...extra });
const post = (url: string, body: unknown, extra: Record<string, string> = {}) => req("POST", url, { headers: writeHeaders(extra), body: JSON.stringify(body) });

function multipart(files: Array<{ name: string; data: Buffer }>): { body: Buffer; type: string } {
  const boundary = `----imgfit${Date.now()}`;
  const parts: Buffer[] = [];
  for (const f of files) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${f.name}"\r\nContent-Type: application/octet-stream\r\n\r\n`, "utf8"), f.data, Buffer.from("\r\n"));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(parts), type: `multipart/form-data; boundary=${boundary}` };
}

async function sseUntilDone(url: string, headers: Record<string, string> = {}): Promise<Array<{ id: number; event: string; data: any }>> {
  const r = await req("GET", url, { headers: authed(headers) });
  return r.body
    .toString("utf8")
    .split("\n\n")
    .filter((b) => b.includes("event:"))
    .map((b) => {
      const get = (k: string) => b.split("\n").find((l) => l.startsWith(`${k}: `))?.slice(k.length + 2) ?? "";
      return { id: Number(get("id")), event: get("event"), data: JSON.parse(get("data")) };
    });
}

/** Minimal ZIP reader: EOCD + central directory â†’ name + data (STORE). */
function readZip(buf: Buffer): Map<string, Buffer> {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = new Map<string, Buffer>();
  for (let i = 0; i < count; i++) {
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString("utf8");
    const lnameLen = buf.readUInt16LE(local + 26);
    const start = local + 30 + lnameLen;
    out.set(name, buf.subarray(start, start + size));
    p += 46 + nameLen;
  }
  return out;
}

beforeAll(async () => {
  ({ dir, cleanup } = await tempDir());
  await mkdir(path.join(dir, "src-img", "photos"), { recursive: true });
  await solid(path.join(dir, "src-img", "photos", "a.jpg"), 400, 300, "#ff0000");
  await solid(path.join(dir, "src-img", "photos", "b.jpg"), 300, 400, "#00ff00");
  await writeFile(
    path.join(dir, "imgfit.json"),
    JSON.stringify({
      schemaVersion: 2,
      presets: { thumb: { size: [64, 64], mode: "cover", format: "webp" } },
    }),
  );
  LIMITS.fileBytes = 200 * 1024; // test the upload limit without a 50 MB file
  server = await startUiServer({ root: dir, port: 0 });
});
afterAll(async () => {
  await server?.close();
  LIMITS.fileBytes = 50 * 1024 * 1024;
  await cleanup();
});

describe("báº£o máº­t server cá»¥c bá»™", () => {
  it("chá»‰ listen 127.0.0.1, URL cÃ³ token", () => {
    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/\?t=[\w-]+$/);
  });

  it("Host láº¡ (DNS rebinding) â†’ 403", async () => {
    const r = await req("GET", "/api/v1/health", { host: "evil.example:80" });
    expect(r.status).toBe(403);
  });

  it("chÆ°a cÃ³ cookie â†’ 401; token sai â†’ 401", async () => {
    expect((await req("GET", "/api/v1/health")).status).toBe(401);
    expect((await req("GET", "/?t=wrong")).status).toBe(401);
  });

  it("token Ä‘Ãºng â†’ cookie HttpOnly SameSite=Strict + redirect bá» token; token chá»‰ dÃ¹ng má»™t láº§n", async () => {
    const token = new URL(server.url).searchParams.get("t") as string;
    const r = await req("GET", `/?t=${token}`);
    expect(r.status).toBe(303);
    expect(r.headers.location).toBe("/");
    const sc = String(r.headers["set-cookie"]);
    expect(sc).toContain("HttpOnly");
    expect(sc).toContain("SameSite=Strict");
    cookie = sc.split(";")[0] as string;
    expect((await req("GET", `/?t=${token}`)).status).toBe(401);
    const h = await req("GET", "/api/v1/health", { headers: authed() });
    expect(h.status).toBe(200);
    expect(h.headers["content-security-policy"]).toContain("default-src 'self'");
    expect(h.headers["x-frame-options"]).toBe("DENY");
    // the static UI is served once the cookie is set
    const page = await req("GET", "/", { headers: authed() });
    expect(page.status).toBe(200);
    expect(page.body.toString()).toContain('<div id="app">');
  });

  it("request ghi: thiáº¿u CSRF header / Origin láº¡ / preflight â†’ bá»‹ cháº·n", async () => {
    expect((await req("POST", "/api/v1/sessions", { headers: authed({ origin: origin() }) })).status).toBe(403);
    expect((await req("POST", "/api/v1/sessions", { headers: authed({ origin: "http://evil.example", "x-imgfit-csrf": "1" }) })).status).toBe(403);
    expect((await req("OPTIONS", "/api/v1/sessions", { headers: authed({ origin: "http://evil.example" }) })).status).toBe(403);
    expect((await post("/api/v1/sessions", {})).status).toBe(201);
  });

  it("khÃ´ng Ä‘á»c Ä‘Æ°á»£c file ngoÃ i allowlist (traversal)", async () => {
    expect((await req("GET", `/api/v1/project/image?source=${encodeURIComponent("../imgfit.json")}`, { headers: authed() })).status).toBe(404);
    expect((await req("GET", "/api/v1/previews/..%2F..%2Fx", { headers: authed() })).status).toBe(404);
    expect((await req("GET", "/api/v1/sessions/nope/files", { headers: authed() })).status).toBe(404);
    expect((await req("GET", "/api/v1/fs?path=/", { headers: authed() })).status).toBe(404);
  });
});

describe("resize nhanh qua API", () => {
  it("preset: dựng sẵn + preset của imgfit.json", async () => {
    const r = (await req("GET", "/api/v1/presets", { headers: authed() })).json();
    expect(r.config.thumb).toMatchObject({ width: 64, height: 64, mode: "cover", format: "webp" });
    expect(Object.keys(r.quick).length).toBeGreaterThan(0);
  });

  let sid: string;
  const ids: string[] = [];

  it("upload: kiá»ƒm tra ná»™i dung, tá»« chá»‘i file giáº£ vÃ  file quÃ¡ lá»›n", async () => {
    sid = (await post("/api/v1/sessions", {})).json().id;
    const good = await readFile(path.join(dir, "src-img", "photos", "a.jpg"));
    const good2 = await readFile(path.join(dir, "src-img", "photos", "b.jpg"));
    const mp = multipart([
      { name: "áº£nh má»™t.jpg", data: good },
      { name: "hai.jpg", data: good2 },
      { name: "fake.jpg", data: Buffer.from("not an image") },
    ]);
    const r = await req("POST", `/api/v1/sessions/${sid}/uploads`, { headers: authed({ origin: origin(), "x-imgfit-csrf": "1", "content-type": mp.type }), body: mp.body });
    expect(r.status).toBe(201);
    const j = r.json();
    expect(j.accepted.map((f: { name: string }) => f.name)).toEqual(["áº£nh má»™t.jpg", "hai.jpg"]);
    expect(j.rejected[0].error.code).toBe("E_INPUT_UNSUPPORTED");
    ids.push(...j.accepted.map((f: { id: string }) => f.id));

    const big = multipart([{ name: "big.jpg", data: Buffer.alloc(300 * 1024, 1) }]);
    const r2 = await req("POST", `/api/v1/sessions/${sid}/uploads`, { headers: authed({ origin: origin(), "x-imgfit-csrf": "1", "content-type": big.type }), body: big.body });
    expect(r2.status).toBe(400);
    expect(r2.json().errors[0].message).toContain("LIMIT_FILE_SIZE");
  });

  it("thumbnail + preview khá»›p kÃ­ch thÆ°á»›c output", async () => {
    const t = await req("GET", `/api/v1/sessions/${sid}/files/${ids[0]}/image?max=128`, { headers: authed() });
    expect(t.status).toBe(200);
    expect(t.headers["content-type"]).toContain("image/webp");
    const p = await post(`/api/v1/sessions/${sid}/preview`, { fileId: ids[0], options: { width: 100, height: 50, mode: "cover", format: "png" }, focal: { x: 0.9, y: 0.5 } });
    expect(p.status).toBe(200);
    expect(p.json()).toMatchObject({ width: 100, height: 50, format: "png" });
    expect((await req("GET", p.json().url, { headers: authed() })).status).toBe(200);
    const bad = await post(`/api/v1/sessions/${sid}/preview`, { fileId: ids[0], options: { width: 100, height: 50, name: "../x.{ext}" } });
    expect(bad.status).toBe(400);
  });

  it("batch: SSE tá»›i khi xong, reconnect báº±ng Last-Event-ID, táº£i file vÃ  ZIP", async () => {
    const b = await post("/api/v1/batches", { sessionId: sid, options: { width: 32, height: 32, mode: "cover", format: "jpg", name: "{name}-{w}.{ext}" } });
    expect(b.status).toBe(202);
    const id = b.json().batchId;
    const events = await sseUntilDone(`/api/v1/batches/${id}/events`);
    expect(events.at(-1)?.event).toBe("done");
    expect(events.at(-1)?.data.status).toBe("ok");
    const replay = await sseUntilDone(`/api/v1/batches/${id}/events`, { "last-event-id": String((events.at(-1)?.id ?? 1) - 1) });
    expect(replay.map((e) => e.event)).toEqual(["done"]);

    const info = (await req("GET", `/api/v1/batches/${id}`, { headers: authed() })).json();
    expect(info.outputs.map((o: { name: string }) => o.name).sort()).toEqual(["hai-32.jpg", "áº£nh má»™t-32.jpg"].sort());
    const one = await req("GET", `/api/v1/batches/${id}/files/0?download=1`, { headers: authed() });
    expect(one.status).toBe(200);
    expect(String(one.headers["content-disposition"])).toContain("attachment");

    const zip = await req("GET", `/api/v1/batches/${id}/archive`, { headers: authed() });
    expect(zip.headers["content-type"]).toContain("application/zip");
    const entries = readZip(zip.body);
    expect([...entries.keys()].sort()).toEqual(["hai-32.jpg", "áº£nh má»™t-32.jpg"].sort());
    expect(entries.get("hai-32.jpg")?.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8])); // JPEG SOI
  });

  it("retry chá»‰ cháº¡y láº¡i file lá»—i", async () => {
    const b = await post("/api/v1/batches", { sessionId: sid, options: { width: 350, height: 350, mode: "cover", format: "jpg" } });
    const id = b.json().batchId;
    await sseUntilDone(`/api/v1/batches/${id}/events`);
    const rep = (await req("GET", `/api/v1/batches/${id}`, { headers: authed() })).json().report;
    expect(rep.summary.failed).toBe(2); // both images are smaller than 350 for cover
    const r = await post(`/api/v1/batches/${id}/retry`, {});
    expect(r.json().total).toBe(2);
  });
});

describe("dá»n dáº¹p", () => {
  it("close() xÃ³a thÆ° má»¥c táº¡m cá»§a phiÃªn", async () => {
    const d = await tempDir();
    try {
      const s = await startUiServer({ root: d.dir, port: 0 });
      const base = (await import("node:os")).tmpdir();
      const before = (await (await import("node:fs/promises")).readdir(base)).filter((n) => n.startsWith("imgfit-ui-"));
      await s.close();
      const after = (await (await import("node:fs/promises")).readdir(base)).filter((n) => n.startsWith("imgfit-ui-"));
      expect(after.length).toBeLessThan(before.length);
      await expect(stat(path.join(base, before.find((b) => !after.includes(b)) as string))).rejects.toThrow();
    } finally {
      await d.cleanup();
    }
  });
});
