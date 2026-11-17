import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createZipStream, MAX_ZIP_ENTRIES, ZipSourceChangedError, ZipTooLargeError } from './zip';
import { collect, readZip } from './zip-test-util';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'zip-test-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const file = (name: string, bytes: Buffer) => {
  const p = join(dir, name);
  writeFileSync(p, bytes);
  return { name: `photos/${name}`, path: p, size: bytes.length };
};

describe('createZipStream', () => {
  it('writes stored entries whose central directory, CRCs and sizes read back', async () => {
    const big = Buffer.alloc(300_000, 7);
    const entries = [
      { name: 'backup.json', data: Buffer.from('{"a":1}') },
      file('A.webp', big),
      file('B.webp', Buffer.alloc(0)),
      file('C.webp', Buffer.from('tiny')),
    ];
    const closed: number[] = [];
    const buf = await collect(createZipStream(entries, { onClose: () => closed.push(1) }));
    const listing = readZip(buf);
    expect(listing.map((e) => e.name)).toEqual([
      'backup.json',
      'photos/A.webp',
      'photos/B.webp',
      'photos/C.webp',
    ]);
    expect(listing.every((e) => e.method === 0)).toBe(true);
    expect(listing[1].data.equals(big)).toBe(true);
    expect(listing[2].size).toBe(0);
    expect(closed).toEqual([1]);
  });

  it('an empty entry list is a valid archive', async () => {
    expect(readZip(await collect(createZipStream([])))).toEqual([]);
  });

  it('refuses ZIP64 territory before producing a byte', () => {
    const many = Array.from({ length: MAX_ZIP_ENTRIES }, (_, i) => ({
      name: `f${i}`,
      data: new Uint8Array(0),
    }));
    expect(() => createZipStream(many)).toThrow(ZipTooLargeError);
    const huge = [{ name: 'photos/x.webp', path: '/nonexistent', size: 0xffff_ffff }];
    expect(() => createZipStream(huge)).toThrow(ZipTooLargeError);
  });

  it('errors the stream when a file grows past its stat size', async () => {
    const e = file('G.webp', Buffer.alloc(1000, 1));
    const stream = createZipStream([{ ...e, size: 10 }]);
    await expect(collect(stream)).rejects.toBeInstanceOf(ZipSourceChangedError);
  });

  it('errors the stream when a file shrinks after stat', async () => {
    const e = file('S.webp', Buffer.alloc(10, 1));
    await expect(collect(createZipStream([{ ...e, size: 1000 }]))).rejects.toBeInstanceOf(
      ZipSourceChangedError,
    );
  });

  it('cancel stops reading, destroys the file stream and closes once', async () => {
    let pulled = 0;
    let source!: Readable;
    const open = () => {
      source = new Readable({
        highWaterMark: 1024,
        read() {
          pulled++;
          this.push(Buffer.alloc(1024, 1));
        },
      });
      return source;
    };
    let closes = 0;
    const stream = createZipStream([{ name: 'photos/X.webp', path: 'x', size: 100_000_000 }], {
      open,
      onClose: () => closes++,
    });
    const reader = stream.getReader();
    await reader.read(); // header
    await reader.read(); // first chunk
    await reader.cancel();
    const after = pulled;
    await new Promise((r) => setTimeout(r, 30));
    expect(source.destroyed).toBe(true);
    expect(pulled).toBe(after);
    expect(pulled).toBeLessThan(10);
    expect(closes).toBe(1);
  });
});

const has = (cmd: string, args: string[]) => !spawnSync(cmd, args).error;

describe('external readers accept the archive', () => {
  const build = async () => {
    const zipPath = join(dir, 'out.zip');
    const entries = [
      { name: 'backup.json', data: Buffer.from('{"version":1}') },
      file('A.webp', Buffer.alloc(200_000, 3)),
      file('B.webp', Buffer.from('hello')),
    ];
    writeFileSync(zipPath, await collect(createZipStream(entries)));
    return zipPath;
  };

  it('python zipfile (python3 -I) testzip is clean', async (ctx) => {
    if (!has('python3', ['-I', '-c', 'pass'])) return ctx.skip('python3 not available');
    const zipPath = await build();
    const r = spawnSync('python3', [
      '-I',
      '-c',
      'import sys, zipfile\nz = zipfile.ZipFile(sys.argv[1])\nassert z.testzip() is None\nprint(",".join(i.filename for i in z.infolist()))',
      zipPath,
    ]);
    expect(r.stderr.toString()).toBe('');
    expect(r.stdout.toString().trim()).toBe('backup.json,photos/A.webp,photos/B.webp');
  });

  it('unzip -t reports no errors', async (ctx) => {
    if (!has('unzip', ['-v'])) return ctx.skip('unzip not available');
    const zipPath = await build();
    const r = spawnSync('unzip', ['-t', zipPath]);
    expect(r.status).toBe(0);
    expect(r.stdout.toString()).toContain('No errors detected');
  });
});
