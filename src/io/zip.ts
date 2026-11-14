/**
 * Streaming ZIP writer using STORE (images are already compressed; deflate gains nothing) with UTF-8 names.
 * Each file is read twice (CRC, then data) so local headers carry sizes — no data descriptors and no whole
 * file in memory. ZIP64 is not supported (each file and the total must stay below 4 GiB).
 */
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { Writable } from "node:stream";
import { crc32 } from "node:zlib";

export interface ZipEntry {
  /** Name inside the archive: relative posix path (sanitised; no "..", no leading "/"). */
  name: string;
  file: string;
}

const LIMIT = 0xffff_fffe;

export function assertSafeEntryName(name: string): void {
  if (name === "" || name.startsWith("/") || /^[a-zA-Z]:/.test(name) || name.includes("\\") || name.split("/").some((s) => s === ".." || s === "." || s === "")) {
    throw new Error(`Tên entry ZIP không an toàn: ${name}`);
  }
}

function dosTime(d: Date): { time: number; date: number } {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

async function fileCrc(file: string): Promise<number> {
  let c = 0;
  for await (const chunk of createReadStream(file)) c = crc32(chunk as Buffer, c);
  return c >>> 0;
}

function write(out: Writable, buf: Buffer): Promise<void> {
  if (out.write(buf)) return Promise.resolve();
  // wait for drain; remove both listeners whichever fires first (no listener leak)
  return new Promise((resolve, reject) => {
    const onDrain = () => {
      out.off("error", onError);
      resolve();
    };
    const onError = (err: Error) => {
      out.off("drain", onDrain);
      reject(err);
    };
    out.once("drain", onDrain);
    out.once("error", onError);
  });
}

export async function writeZip(out: Writable, entries: ZipEntry[], signal?: AbortSignal): Promise<void> {
  const central: Buffer[] = [];
  let offset = 0;
  const { time, date } = dosTime(new Date());

  for (const e of entries) {
    if (signal?.aborted) throw new Error("aborted");
    assertSafeEntryName(e.name);
    const size = (await stat(e.file)).size;
    if (size > LIMIT || offset > LIMIT) throw new Error("ZIP vượt 4 GiB (không hỗ trợ ZIP64)");
    const crc = await fileCrc(e.file);
    const name = Buffer.from(e.name.normalize("NFC"), "utf8");

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // bit 11: UTF-8 names
    local.writeUInt16LE(0, 8); // STORE
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(size, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    await write(out, local);
    await write(out, name);
    for await (const chunk of createReadStream(e.file)) await write(out, chunk as Buffer);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(0x031e, 4); // made by: unix, v3.0
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(0, 10);
    cd.writeUInt16LE(time, 12);
    cd.writeUInt16LE(date, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(size, 20);
    cd.writeUInt32LE(size, 24);
    cd.writeUInt16LE(name.length, 28);
    cd.writeUInt32LE((0o100644 << 16) >>> 0, 38); // regular file permissions
    cd.writeUInt32LE(offset, 42);
    central.push(cd, name);
    offset += 30 + name.length + size;
  }

  const cdBuf = Buffer.concat(central);
  if (offset > LIMIT || entries.length > 0xfffe) throw new Error("ZIP quá lớn (không hỗ trợ ZIP64)");
  await write(out, cdBuf);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cdBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  await write(out, end);
}
