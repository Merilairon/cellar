import { open, type FileHandle } from 'node:fs/promises';
import { createInflateRaw, crc32 } from 'node:zlib';
import { BACKUP_ENTRY } from './zip';
import { PHOTO_PATH_RE } from './schema';

// Bounded central-directory reader for untrusted backup archives (T11, R12). File based: only
// ranges are read through a handle, never the whole archive. Stored (0) and deflated (8) entries
// only; ZIP64, encryption, other methods, unexpected names, duplicates and overlapping data are
// refusals of the WHOLE archive. Every size and offset is checked against the file length
// before it is used, inflating has a hard output limit (the declared size), and CRC-32 is
// verified. Entries are read one at a time: the caller holds at most one entry in memory.

export const MAX_ENTRIES = 60_000;
/** Max central directory bytes read into memory (60 000 records of about 90 bytes is 5.4 MB). */
export const MAX_CENTRAL_BYTES = 8 * 1024 * 1024;
export const MAX_PHOTO_BYTES = 20 * 1024 * 1024;
/**
 * Largest the manifest. A 5 000 recipe export of the fixture shape is about 23 MiB (measured
 * 4.84 MB per 1 000 recipes by scripts/export-sizes.ts), so 32 MiB leaves headroom while still
 * bounding parse time and memory (AppSec M1). Export refuses to produce anything larger.
 */
export const MAX_MANIFEST_BYTES = 32 * 1024 * 1024;
/** Test seam: the cap `GET /api/export` applies to the manifest it would produce. */
export const exportCaps = { manifestBytes: MAX_MANIFEST_BYTES };
export const MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024;
/** Deflate expansion limit (declared size / compressed size). JSON is about 10x to 30x. */
export const MAX_RATIO = 200;

const EOCD_SIG = 0x06054b50;
const ZIP64_LOCATOR_SIG = 0x07064b50;
const CENTRAL_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;
const EOCD_MIN = 22;
const MAX_COMMENT = 0xffff;
const CHUNK = 64 * 1024;

export type ZipLimits = {
  maxEntries?: number;
  maxPhotoBytes?: number;
  maxManifestBytes?: number;
  maxTotalBytes?: number;
  maxRatio?: number;
};

/** The archive is unreadable or hostile. `reason` is a stable machine word (never user text). */
export class ZipFormatError extends Error {
  constructor(
    readonly reason: string,
    /** Display-safe name of the refused entry (control characters stripped, at most 80 chars). */
    readonly entry?: string,
  ) {
    super(`zip_invalid: ${reason}`);
    this.name = 'ZipFormatError';
  }
}

export type ZipEntryInfo = {
  name: string;
  method: 0 | 8;
  crc: number;
  compressedSize: number;
  size: number;
  localOffset: number;
  nameBytes: Buffer;
  cdOffset: number;
};

export type OpenedZip = {
  /** Entry names in archive order. */
  names: string[];
  has(name: string): boolean;
  /** Declared uncompressed size, or undefined for an unknown name. */
  sizeOf(name: string): number | undefined;
  /** Read and verify one entry (inflate with a hard limit, CRC-32). Throws ZipFormatError. */
  read(name: string): Promise<Buffer>;
  close(): Promise<void>;
};

const bad = (reason: string): never => {
  throw new ZipFormatError(reason);
};

/** An archive entry name is exactly the manifest or a photo path; anything else is refused. */
export function isAllowedEntryName(name: string): boolean {
  return name === BACKUP_ENTRY || PHOTO_PATH_RE.test(name);
}

/**
 * Entries that tools add when a backup is unzipped and zipped again: directory entries (name
 * ends with a slash, no data), the macOS resource-fork folder, `.DS_Store` and `Thumbs.db`.
 * They are skipped: never read, never counted against the size caps.
 */
export function isIgnorableEntry(name: string, size: number): boolean {
  if (name.endsWith('/')) return size === 0;
  if (name.startsWith('__MACOSX/')) return true;
  const base = name.slice(name.lastIndexOf('/') + 1);
  return base === '.DS_Store' || base === 'Thumbs.db';
}

/** A name safe to show in an error: decoded, control characters stripped, 80 chars at most. */
export function displayEntryName(nameBytes: Buffer): string {
  const text = nameBytes
    .toString('utf8')
    .replace(/[\p{C}\p{Z}]/gu, (c) => (c === ' ' ? c : ''))
    .trim();
  return text.length > 80 ? `${text.slice(0, 80)}...` : text;
}

/** A single top-level folder name as Finder or `zip -r folder` writes it. */
const FOLDER_RE = /^[A-Za-z0-9._ -]{1,64}$/;

/**
 * When every refused-as-is entry lives under one common top-level folder (Finder "Compress"),
 * the prefix to strip, else ''. All names must be allowed once stripped; an archive that already
 * has the manifest or a photo at the top is never prefix-stripped.
 */
function commonFolderPrefix(names: string[]): string {
  if (names.length === 0 || names.some(isAllowedEntryName)) return '';
  const slash = names[0]!.indexOf('/');
  if (slash <= 0) return '';
  const folder = names[0]!.slice(0, slash);
  if (!FOLDER_RE.test(folder) || folder === '.' || folder === '..') return '';
  const prefix = `${folder}/`;
  return names.every((n) => n.startsWith(prefix) && isAllowedEntryName(n.slice(prefix.length)))
    ? prefix
    : '';
}

async function readRange(h: FileHandle, position: number, length: number): Promise<Buffer> {
  const buf = Buffer.alloc(length);
  let done = 0;
  while (done < length) {
    const { bytesRead } = await h.read(buf, done, length - done, position + done);
    if (bytesRead === 0) bad('truncated');
    done += bytesRead;
  }
  return buf;
}

function findEocd(tail: Buffer, tailStart: number, fileSize: number): number {
  for (let i = tail.length - EOCD_MIN; i >= 0; i--) {
    if (tail.readUInt32LE(i) !== EOCD_SIG) continue;
    const commentLen = tail.readUInt16LE(i + 20);
    // The comment must run exactly to the end of the file: a record in the middle of a comment
    // or followed by trailing bytes is not the end record this reader accepts.
    if (tailStart + i + EOCD_MIN + commentLen === fileSize) return i;
  }
  return bad('eocd_missing');
}

export async function openZip(path: string, limits: ZipLimits = {}): Promise<OpenedZip> {
  const maxEntries = limits.maxEntries ?? MAX_ENTRIES;
  const maxPhoto = limits.maxPhotoBytes ?? MAX_PHOTO_BYTES;
  const maxManifest = limits.maxManifestBytes ?? MAX_MANIFEST_BYTES;
  const maxTotal = limits.maxTotalBytes ?? MAX_TOTAL_BYTES;
  const maxRatio = limits.maxRatio ?? MAX_RATIO;

  const h = await open(path, 'r');
  try {
    const fileSize = (await h.stat()).size;
    if (fileSize < EOCD_MIN) bad('too_small');

    // End record: search only the last 64 KiB + 22 bytes (the maximum comment length).
    const tailLen = Math.min(fileSize, EOCD_MIN + MAX_COMMENT);
    const tailStart = fileSize - tailLen;
    const tail = await readRange(h, tailStart, tailLen);
    const e = findEocd(tail, tailStart, fileSize);
    const eocdPos = tailStart + e;
    const disk = tail.readUInt16LE(e + 4);
    const cdDisk = tail.readUInt16LE(e + 6);
    const onDisk = tail.readUInt16LE(e + 8);
    const total = tail.readUInt16LE(e + 10);
    const cdSize = tail.readUInt32LE(e + 12);
    const cdOffset = tail.readUInt32LE(e + 16);
    if (disk !== 0 || cdDisk !== 0 || onDisk !== total) bad('multi_disk');
    // ZIP64 markers (or a ZIP64 locator before the end record) are refused: this format never
    // needs them (the writer stops at 65 535 entries and 4 GiB).
    if (total === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) bad('zip64');
    if (e >= 20 && tail.readUInt32LE(e - 20) === ZIP64_LOCATOR_SIG) bad('zip64');
    if (total > maxEntries) bad('too_many_entries');
    if (cdSize > MAX_CENTRAL_BYTES) bad('central_directory_too_large');
    if (cdOffset + cdSize !== eocdPos) bad('central_directory_out_of_range');
    if (total * 46 > cdSize) bad('entry_count_mismatch');

    const cd = await readRange(h, cdOffset, cdSize);
    const records: ZipEntryInfo[] = [];
    let p = 0;
    for (let i = 0; i < total; i++) {
      if (p + 46 > cd.length) bad('entry_count_mismatch');
      if (cd.readUInt32LE(p) !== CENTRAL_SIG) bad('bad_central_record');
      const flags = cd.readUInt16LE(p + 8);
      const method = cd.readUInt16LE(p + 10);
      const crc = cd.readUInt32LE(p + 16);
      const compressedSize = cd.readUInt32LE(p + 20);
      const size = cd.readUInt32LE(p + 24);
      const nameLen = cd.readUInt16LE(p + 28);
      const extraLen = cd.readUInt16LE(p + 30);
      const commentLen = cd.readUInt16LE(p + 32);
      const startDisk = cd.readUInt16LE(p + 34);
      const localOffset = cd.readUInt32LE(p + 42);
      const next = p + 46 + nameLen + extraLen + commentLen;
      if (next > cd.length) bad('entry_count_mismatch');
      if ((flags & 0x0001) !== 0 || (flags & 0x0040) !== 0) bad('encrypted');
      if (method !== 0 && method !== 8) bad('unsupported_method');
      if (startDisk !== 0) bad('multi_disk');
      if (
        compressedSize === 0xffffffff ||
        size === 0xffffffff ||
        localOffset === 0xffffffff ||
        startDisk === 0xffff
      ) {
        bad('zip64');
      }
      // Names are checked as raw bytes before any decoding: printable ASCII only, so NUL,
      // backslash, control bytes and non-ASCII never reach a path or a log line.
      const nameBytes = Buffer.from(cd.subarray(p + 46, p + 46 + nameLen));
      const name = nameBytes.toString('latin1');
      if (isIgnorableEntry(name, size)) {
        p = next;
        continue;
      }
      records.push({
        name,
        cdOffset,
        method: method as 0 | 8,
        crc,
        compressedSize,
        size,
        localOffset,
        nameBytes,
      });
      p = next;
    }
    if (p !== cd.length) bad('entry_count_mismatch');

    // Names, caps and offsets are checked on the kept entries, after one common top-level folder
    // (and only that) has been stripped from all of them.
    const prefix = commonFolderPrefix(records.map((r) => r.name));
    const entries = new Map<string, ZipEntryInfo>();
    let totalSize = 0;
    for (const info of records) {
      const name = info.name.slice(prefix.length);
      if (!isAllowedEntryName(name)) {
        throw new ZipFormatError('entry_name_not_allowed', displayEntryName(info.nameBytes));
      }
      if (entries.has(name)) bad('duplicate_entry');
      const { size, compressedSize, method, localOffset } = info;
      const cap = name === BACKUP_ENTRY ? maxManifest : maxPhoto;
      if (size > cap) bad('entry_too_large');
      totalSize += size;
      if (totalSize > maxTotal) bad('archive_too_large');
      if (method === 0) {
        if (compressedSize !== size) bad('size_mismatch');
      } else {
        if (size > 0 && compressedSize === 0) bad('ratio');
        if (compressedSize > 0 && size / compressedSize > maxRatio) bad('ratio');
        if (compressedSize > cap + 1024 * 1024) bad('entry_too_large');
      }
      // The data must sit before the central directory, local header included.
      if (localOffset + 30 + info.nameBytes.length + compressedSize > cdOffset) {
        bad('entry_out_of_range');
      }
      entries.set(name, { ...info, name });
    }
    // Overlapping entries are how small archives claim huge totals: refuse them.
    const byOffset = [...entries.values()].sort((a, b) => a.localOffset - b.localOffset);
    for (let i = 1; i < byOffset.length; i++) {
      const prev = byOffset[i - 1]!;
      if (
        byOffset[i]!.localOffset <
        prev.localOffset + 30 + prev.nameBytes.length + prev.compressedSize
      ) {
        bad('overlapping_entries');
      }
    }

    let closed = false;
    return {
      names: [...entries.keys()],
      has: (n) => entries.has(n),
      sizeOf: (n) => entries.get(n)?.size,
      async read(name) {
        const info = entries.get(name);
        if (!info) return bad('entry_missing');
        if (closed) return bad('closed');
        return readEntry(h, info);
      },
      async close() {
        if (closed) return;
        closed = true;
        await h.close().catch(() => undefined);
      },
    };
  } catch (err) {
    await h.close().catch(() => undefined);
    throw err;
  }
}

async function readEntry(h: FileHandle, info: ZipEntryInfo): Promise<Buffer> {
  const local = await readRange(h, info.localOffset, 30);
  if (local.readUInt32LE(0) !== LOCAL_SIG) bad('bad_local_header');
  const flags = local.readUInt16LE(6);
  const method = local.readUInt16LE(8);
  if ((flags & 0x0001) !== 0 || (flags & 0x0040) !== 0) bad('encrypted');
  if (method !== info.method) bad('header_mismatch');
  const nameLen = local.readUInt16LE(26);
  const extraLen = local.readUInt16LE(28);
  if (nameLen !== info.nameBytes.length) bad('header_mismatch');
  const localName = await readRange(h, info.localOffset + 30, nameLen);
  if (!localName.equals(info.nameBytes)) bad('header_mismatch');
  // With bit 3 the local header carries zeros and a data descriptor follows; otherwise the
  // local copy must agree with the central directory (which is what is trusted).
  if ((flags & 0x0008) === 0) {
    if (
      local.readUInt32LE(14) !== info.crc ||
      local.readUInt32LE(18) !== info.compressedSize ||
      local.readUInt32LE(22) !== info.size
    ) {
      bad('header_mismatch');
    }
  }
  const start = info.localOffset + 30 + nameLen + extraLen;
  const fileEnd = (await h.stat()).size;
  if (start + info.compressedSize > Math.min(fileEnd, info.cdOffset)) bad('entry_out_of_range');

  const data =
    info.method === 0
      ? await readRange(h, start, info.size)
      : await inflateRange(h, start, info.compressedSize, info.size);
  if (data.length !== info.size) bad('size_mismatch');
  if (crc32(data) !== info.crc) bad('crc_mismatch');
  return data;
}

/** Inflate `compressedSize` bytes at `start`; stop with an error as soon as output passes `size`. */
function inflateRange(
  h: FileHandle,
  start: number,
  compressedSize: number,
  size: number,
): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const inflater = createInflateRaw({ chunkSize: 16 * 1024 });
    const out: Buffer[] = [];
    let produced = 0;
    let settled = false;
    const fail = (reason: string) => {
      if (settled) return;
      settled = true;
      inflater.destroy();
      reject(new ZipFormatError(reason));
    };
    inflater.on('data', (chunk: Buffer) => {
      produced += chunk.length;
      if (produced > size) return fail('size_mismatch');
      out.push(chunk);
    });
    inflater.on('error', () => fail('inflate_failed'));
    inflater.on('end', () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(out, produced));
    });
    (async () => {
      let done = 0;
      while (done < compressedSize && !settled) {
        const n = Math.min(CHUNK, compressedSize - done);
        const chunk = await readRange(h, start + done, n);
        done += n;
        if (settled) return;
        if (!inflater.write(chunk)) {
          await new Promise<void>((r) => {
            const wake = () => {
              inflater.off('drain', wake);
              inflater.off('close', wake);
              r();
            };
            inflater.once('drain', wake);
            inflater.once('close', wake);
          });
        }
      }
      if (!settled) inflater.end();
    })().catch((err: unknown) => fail(err instanceof ZipFormatError ? err.reason : 'read_failed'));
  });
}
