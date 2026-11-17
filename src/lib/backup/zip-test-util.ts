// Test-only: a tiny central-directory reader to cross-check the writer (T10). Not the T11
// reader (`unzip.ts`, bounded and hardened); it trusts its input and is never imported by app code.
import { crc32 } from 'node:zlib';

export type ZipListing = { name: string; crc: number; size: number; data: Buffer; method: number };

export function readZip(buf: Buffer): ZipListing[] {
  const eocd = buf.length - 22;
  if (buf.readUInt32LE(eocd) !== 0x06054b50) throw new Error('no end record');
  const count = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdStart = buf.readUInt32LE(eocd + 16);
  if (cdStart + cdSize !== eocd)
    throw new Error('central directory does not end at the end record');
  const out: ZipListing[] = [];
  let p = cdStart;
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('bad central record');
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const csize = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const offset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    if (buf.readUInt32LE(offset) !== 0x04034b50) throw new Error('bad local header');
    const lname = buf.readUInt16LE(offset + 26);
    const lextra = buf.readUInt16LE(offset + 28);
    const start = offset + 30 + lname + lextra;
    const data = buf.subarray(start, start + usize);
    if (csize !== usize) throw new Error('stored entry with differing sizes');
    if (crc32(data) !== crc) throw new Error(`crc mismatch for ${name}`);
    out.push({ name, crc, size: usize, data, method });
    p += 46 + nameLen + extraLen + commentLen;
  }
  if (p !== cdStart + cdSize) throw new Error('central directory size mismatch');
  return out;
}

export async function collect(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}
