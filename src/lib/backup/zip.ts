import { createReadStream } from 'node:fs';
import type { Readable } from 'node:stream';
import { crc32 } from 'node:zlib';

// Stored-entry (method 0) streaming zip writer (T10, G14, Q6). No dependency, no ZIP64.
//
// Design: in-memory entries (the manifest) have their CRC and size up front, so they use a
// plain local header. File entries are streamed once: the CRC is computed while the bytes go
// out, so the local header sets general-purpose bit 3 (zeros in the header) and a data
// descriptor after the data carries CRC and sizes. This avoids a second read pass of every
// photo. Sizes from `stat` are used only to refuse an oversize archive before the first byte
// and as an upper bound while streaming; a file that grows past its stat size aborts the stream
// (a truncated download is detectable, a silently wrong archive is not). Readers must use the
// central directory (which `unzip`, Python `zipfile` and the T11 reader do).

// Joined on purpose: tests/unit/i18n-keys.test.ts reads a quoted backup-dot-json literal as a
// message key of the `backup` namespace.
export const BACKUP_ENTRY = ['backup', 'json'].join('.');

export const MAX_ZIP_ENTRIES = 0xffff;
export const MAX_ZIP_BYTES = 0xffff_ffff;

/** The archive would need ZIP64 (over 4 GiB or 65 535 entries). The route maps this to 413. */
export class ZipTooLargeError extends Error {
  constructor() {
    super('export_too_large');
  }
}

/** A file changed size while it was being streamed. */
export class ZipSourceChangedError extends Error {
  constructor() {
    super('zip_source_changed');
  }
}

export type ZipEntry = { name: string } & ({ data: Uint8Array } | { path: string; size: number });

export type ZipOptions = {
  now?: Date;
  /** Test seam: how a file is opened. Defaults to `createReadStream` with 64 KiB chunks. */
  open?: (path: string) => Readable;
  /** Called exactly once when the stream ends, errors or is cancelled. */
  onClose?: () => void;
};

const SIG_LOCAL = 0x04034b50;
const SIG_DESCRIPTOR = 0x08074b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_END = 0x06054b50;
const FLAG_DESCRIPTOR = 0x0008;
const FLAG_UTF8 = 0x0800;
const VERSION_NEEDED = 20;
const VERSION_MADE_BY = (3 << 8) | 20; // Unix, 2.0: lets `unzip` apply the mode below
const EXTERNAL_ATTR = (0o100644 << 16) >>> 0;

function dosDateTime(d: Date): { time: number; date: number } {
  const year = Math.min(Math.max(d.getUTCFullYear(), 1980), 2107);
  return {
    time: (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | (d.getUTCSeconds() >> 1),
    date: ((year - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate(),
  };
}

type Done = { name: Buffer; flags: number; crc: number; size: number; offset: number };

function localHeader(
  name: Buffer,
  flags: number,
  t: { time: number; date: number },
  crc: number,
  size: number,
): Buffer {
  const b = Buffer.alloc(30 + name.length);
  b.writeUInt32LE(SIG_LOCAL, 0);
  b.writeUInt16LE(VERSION_NEEDED, 4);
  b.writeUInt16LE(flags, 6);
  b.writeUInt16LE(0, 8); // method 0: stored
  b.writeUInt16LE(t.time, 10);
  b.writeUInt16LE(t.date, 12);
  b.writeUInt32LE(crc, 14);
  b.writeUInt32LE(size, 18); // compressed
  b.writeUInt32LE(size, 22); // uncompressed
  b.writeUInt16LE(name.length, 26);
  b.writeUInt16LE(0, 28);
  name.copy(b, 30);
  return b;
}

function centralRecord(e: Done, t: { time: number; date: number }): Buffer {
  const b = Buffer.alloc(46 + e.name.length);
  b.writeUInt32LE(SIG_CENTRAL, 0);
  b.writeUInt16LE(VERSION_MADE_BY, 4);
  b.writeUInt16LE(VERSION_NEEDED, 6);
  b.writeUInt16LE(e.flags, 8);
  b.writeUInt16LE(0, 10);
  b.writeUInt16LE(t.time, 12);
  b.writeUInt16LE(t.date, 14);
  b.writeUInt32LE(e.crc, 16);
  b.writeUInt32LE(e.size, 20);
  b.writeUInt32LE(e.size, 24);
  b.writeUInt16LE(e.name.length, 28);
  // extra, comment, disk, internal attributes stay 0
  b.writeUInt32LE(EXTERNAL_ATTR, 38);
  b.writeUInt32LE(e.offset, 42);
  e.name.copy(b, 46);
  return b;
}

/** Upper bound of the archive size from declared sizes; throws when ZIP64 would be needed. */
function checkLimits(entries: ZipEntry[]): void {
  if (entries.length >= MAX_ZIP_ENTRIES) throw new ZipTooLargeError();
  let total = 22;
  for (const e of entries) {
    const n = Buffer.byteLength(e.name, 'utf8');
    const size = 'data' in e ? e.data.byteLength : e.size;
    total += 30 + n + size + 16 + 46 + n; // 16: descriptor (counted for every entry, a safe bound)
    if (total >= MAX_ZIP_BYTES) throw new ZipTooLargeError();
  }
}

/**
 * Build a stored zip as a pull-driven `ReadableStream`: a file chunk is read only when the
 * consumer asks for it, so memory is one chunk, not one file. Cancelling (client abort) closes
 * the open file stream and stops reading. Throws `ZipTooLargeError` before returning if the
 * declared sizes need ZIP64.
 */
export function createZipStream(
  entries: ZipEntry[],
  opts: ZipOptions = {},
): ReadableStream<Uint8Array> {
  checkLimits(entries);
  const open = opts.open ?? ((p: string) => createReadStream(p, { highWaterMark: 64 * 1024 }));
  const stamp = dosDateTime(opts.now ?? new Date());

  async function* generate(): AsyncGenerator<Uint8Array, void, undefined> {
    const done: Done[] = [];
    let offset = 0;
    for (const e of entries) {
      const name = Buffer.from(e.name, 'utf8');
      const start = offset;
      if ('data' in e) {
        const crc = crc32(e.data);
        const head = localHeader(name, FLAG_UTF8, stamp, crc, e.data.byteLength);
        offset += head.length + e.data.byteLength;
        done.push({ name, flags: FLAG_UTF8, crc, size: e.data.byteLength, offset: start });
        yield head;
        if (e.data.byteLength > 0) yield e.data;
        continue;
      }
      const flags = FLAG_UTF8 | FLAG_DESCRIPTOR;
      const head = localHeader(name, flags, stamp, 0, 0);
      offset += head.length;
      yield head;
      const stream = open(e.path);
      let crc = 0;
      let size = 0;
      try {
        for await (const chunk of stream as AsyncIterable<Buffer>) {
          size += chunk.length;
          if (size > e.size || offset + chunk.length >= MAX_ZIP_BYTES) {
            throw new ZipSourceChangedError();
          }
          crc = crc32(chunk, crc);
          offset += chunk.length;
          yield chunk;
        }
      } finally {
        stream.destroy();
      }
      if (size !== e.size) throw new ZipSourceChangedError(); // shrank after stat
      const desc = Buffer.alloc(16);
      desc.writeUInt32LE(SIG_DESCRIPTOR, 0);
      desc.writeUInt32LE(crc, 4);
      desc.writeUInt32LE(size, 8);
      desc.writeUInt32LE(size, 12);
      offset += desc.length;
      done.push({ name, flags, crc, size, offset: start });
      yield desc;
    }
    const cdStart = offset;
    let cdSize = 0;
    for (const d of done) {
      const rec = centralRecord(d, stamp);
      cdSize += rec.length;
      yield rec;
    }
    const end = Buffer.alloc(22);
    end.writeUInt32LE(SIG_END, 0);
    end.writeUInt16LE(done.length, 8);
    end.writeUInt16LE(done.length, 10);
    end.writeUInt32LE(cdSize, 12);
    end.writeUInt32LE(cdStart, 16);
    yield end;
  }

  const gen = generate();
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    opts.onClose?.();
  };
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const r = await gen.next();
        if (r.done) {
          close();
          controller.close();
        } else {
          controller.enqueue(r.value);
        }
      } catch (err) {
        console.error('[export] stream failed', (err as Error).message);
        close();
        controller.error(err);
      }
    },
    async cancel() {
      try {
        await gen.return(undefined);
      } finally {
        close();
      }
    },
  });
}
