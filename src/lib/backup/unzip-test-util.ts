// Test-only: a zip builder with every field overridable, to make hostile archives for the
// T11 reader tests. Never imported by app code.
import { crc32, deflateRawSync } from 'node:zlib';

export type RawEntry = {
  name: string | Buffer;
  data: Buffer;
  /** 0 stored (default), 8 deflated. */
  method?: number;
  flags?: number;
  /** Central directory overrides. */
  crc?: number;
  csize?: number;
  usize?: number;
  /** Local header overrides. */
  localName?: string | Buffer;
  localMethod?: number;
  localCrc?: number;
  /** Store these bytes as the entry data instead of the encoded `data`. */
  rawData?: Buffer;
  extra?: Buffer;
};

export type RawZipOptions = {
  count?: number;
  cdOffset?: number;
  cdSize?: number;
  comment?: Buffer;
  /** Insert a ZIP64 end-of-central-directory locator before the end record. */
  zip64Locator?: boolean;
  /** Append bytes after the end record. */
  trailing?: Buffer;
};

const nameBuf = (n: string | Buffer) => (typeof n === 'string' ? Buffer.from(n, 'latin1') : n);

export function rawZip(entries: RawEntry[], opts: RawZipOptions = {}): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const method = e.method ?? 0;
    const encoded = e.rawData ?? (method === 8 ? deflateRawSync(e.data) : e.data);
    const crc = e.crc ?? crc32(e.data);
    const csize = e.csize ?? encoded.length;
    const usize = e.usize ?? e.data.length;
    const name = nameBuf(e.name);
    const lname = nameBuf(e.localName ?? e.name);
    const extra = e.extra ?? Buffer.alloc(0);
    const local = Buffer.alloc(30 + lname.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(e.flags ?? 0, 6);
    local.writeUInt16LE(e.localMethod ?? method, 8);
    local.writeUInt32LE(e.localCrc ?? crc, 14);
    local.writeUInt32LE(csize, 18);
    local.writeUInt32LE(usize, 22);
    local.writeUInt16LE(lname.length, 26);
    local.writeUInt16LE(extra.length, 28);
    lname.copy(local, 30);
    const c = Buffer.alloc(46 + name.length);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(e.flags ?? 0, 8);
    c.writeUInt16LE(method, 10);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(csize, 20);
    c.writeUInt32LE(usize, 24);
    c.writeUInt16LE(name.length, 28);
    c.writeUInt32LE(offset, 42);
    name.copy(c, 46);
    central.push(c);
    parts.push(local, extra, encoded);
    offset += local.length + extra.length + encoded.length;
  }
  const cd = Buffer.concat(central);
  const comment = opts.comment ?? Buffer.alloc(0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(opts.count ?? entries.length, 8);
  end.writeUInt16LE(opts.count ?? entries.length, 10);
  end.writeUInt32LE(opts.cdSize ?? cd.length, 12);
  end.writeUInt32LE(opts.cdOffset ?? offset, 16);
  end.writeUInt16LE(comment.length, 20);
  const locator = Buffer.alloc(opts.zip64Locator ? 20 : 0);
  if (opts.zip64Locator) locator.writeUInt32LE(0x07064b50, 0);
  return Buffer.concat([...parts, cd, locator, end, comment, opts.trailing ?? Buffer.alloc(0)]);
}
