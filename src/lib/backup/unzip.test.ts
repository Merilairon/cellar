import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { ulid } from 'ulid';
import { MAX_MANIFEST_BYTES, openZip, ZipFormatError, type OpenedZip } from './unzip';
import { rawZip, type RawEntry } from './unzip-test-util';
import { BACKUP_ENTRY, createZipStream } from './zip';
import { collect } from './zip-test-util';

// Passive wrapper: counts every byte the inflater emits, to prove the output limit stops early.
const inflated = vi.hoisted(() => ({ bytes: 0 }));
vi.mock('node:zlib', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:zlib')>();
  return {
    ...real,
    createInflateRaw: (...args: Parameters<typeof real.createInflateRaw>) => {
      const stream = real.createInflateRaw(...args);
      stream.on('data', (c: Buffer) => {
        inflated.bytes += c.length;
      });
      return stream;
    },
  };
});

const dir = mkdtempSync(join(tmpdir(), 'unzip-test-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
let n = 0;
const put = (bytes: Buffer): string => {
  const p = join(dir, `z${n++}.zip`);
  writeFileSync(p, bytes);
  return p;
};

const photo = () => `photos/${ulid()}.webp`;
const json = Buffer.from('{"version":1}');
const manifest = (extra: Partial<RawEntry> = {}): RawEntry => ({
  name: BACKUP_ENTRY,
  data: json,
  ...extra,
});

async function reasonOf(bytes: Buffer, limits = {}): Promise<string> {
  let zip: OpenedZip | undefined;
  try {
    zip = await openZip(put(bytes), limits);
    for (const name of zip.names) await zip.read(name);
  } catch (e) {
    expect(e).toBeInstanceOf(ZipFormatError);
    return (e as ZipFormatError).reason;
  } finally {
    await zip?.close();
  }
  return 'accepted';
}

describe('openZip: valid archives', () => {
  it('reads stored and deflated entries and verifies them', async () => {
    const name = photo();
    const big = Buffer.from('abc'.repeat(1000));
    const zip = await openZip(
      put(rawZip([manifest(), { name, data: big, method: 8 }], { comment: Buffer.from('hi') })),
    );
    expect(zip.names).toEqual([BACKUP_ENTRY, name]);
    expect(zip.has(name)).toBe(true);
    expect(zip.sizeOf(name)).toBe(3000);
    expect((await zip.read(BACKUP_ENTRY)).equals(json)).toBe(true);
    expect((await zip.read(name)).equals(big)).toBe(true);
    await zip.close();
  });

  it('reads what the T10 writer produces, descriptors and all', async () => {
    const file = join(dir, 'photo-src.bin');
    writeFileSync(file, Buffer.from('photo bytes'));
    const name = photo();
    const stream = createZipStream([
      { name: BACKUP_ENTRY, data: json },
      { name, path: file, size: 11 },
    ]);
    const zip = await openZip(put(await collect(stream)));
    expect((await zip.read(name)).toString()).toBe('photo bytes');
    expect((await zip.read(BACKUP_ENTRY)).equals(json)).toBe(true);
    await zip.close();
  });

  it('accepts an empty archive and an unknown entry name is not readable', async () => {
    const zip = await openZip(put(rawZip([])));
    expect(zip.names).toEqual([]);
    await expect(zip.read(BACKUP_ENTRY)).rejects.toMatchObject({ reason: 'entry_missing' });
    await zip.close();
  });
});

describe('openZip: re-zipped archives (M1)', () => {
  const noise: Array<[string, RawEntry]> = [
    ['a photos/ directory entry', { name: 'photos/', data: Buffer.alloc(0) }],
    ['a __MACOSX resource fork', { name: '__MACOSX/._backup.json', data: Buffer.from('fork') }],
    ['a __MACOSX directory', { name: '__MACOSX/', data: Buffer.alloc(0) }],
    ['.DS_Store', { name: '.DS_Store', data: Buffer.from('ds') }],
    ['photos/.DS_Store', { name: 'photos/.DS_Store', data: Buffer.from('ds') }],
    ['Thumbs.db', { name: 'Thumbs.db', data: Buffer.from('db') }],
  ];
  it.each(noise)('skips %s', async (_label, extra) => {
    const zip = await openZip(put(rawZip([extra, manifest()])));
    expect(zip.names).toEqual([BACKUP_ENTRY]);
    expect(zip.has(extra.name as string)).toBe(false);
    expect((await zip.read(BACKUP_ENTRY)).equals(json)).toBe(true);
    await zip.close();
  });
  it('skipped entries do not count toward the size caps', async () => {
    const big = { name: '__MACOSX/._x', data: Buffer.alloc(1000, 1) };
    expect(
      await reasonOf(rawZip([manifest(), big]), { maxTotalBytes: 100, maxPhotoBytes: 4 }),
    ).toBe('accepted');
  });
  it('a directory name with data is not a directory entry and is refused', async () => {
    expect(await reasonOf(rawZip([manifest(), { name: 'photos/', data: json }]))).toBe(
      'entry_name_not_allowed',
    );
  });
  it('a real file next to the manifest is refused and named', async () => {
    const err = await openZip(put(rawZip([manifest(), { name: 'notes.txt', data: json }]))).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ZipFormatError);
    expect((err as ZipFormatError).reason).toBe('entry_name_not_allowed');
    expect((err as ZipFormatError).entry).toBe('notes.txt');
  });
  it('the refused name is truncated to 80 characters and stripped of control characters', async () => {
    const long = `${'a'.repeat(200)}\u0007\n.txt`;
    const err = await openZip(put(rawZip([{ name: `x\u001b[31m${long}`, data: json }]))).catch(
      (e: unknown) => e,
    );
    const shown = (err as ZipFormatError).entry!;
    expect(shown).not.toMatch(/[\u0000-\u001f\u007f]/);
    expect(shown.length).toBeLessThanOrEqual(83);
    expect(shown.startsWith('x[31m')).toBe(true);
  });
  it('accepts one common top-level folder (Finder style) and strips it from every name', async () => {
    const name = photo();
    const zip = await openZip(
      put(
        rawZip([
          { name: 'cellar-backup/', data: Buffer.alloc(0) },
          { name: `cellar-backup/${BACKUP_ENTRY}`, data: json },
          { name: `cellar-backup/${name}`, data: Buffer.from('p') },
          { name: '__MACOSX/cellar-backup/._backup.json', data: Buffer.from('f') },
        ]),
      ),
    );
    expect(zip.names).toEqual([BACKUP_ENTRY, name]);
    expect((await zip.read(name)).toString()).toBe('p');
    expect((await zip.read(BACKUP_ENTRY)).equals(json)).toBe(true);
    await zip.close();
  });
  it('refuses a folder prefix that is not applied to every entry', async () => {
    expect(
      await reasonOf(
        rawZip([
          { name: `a/${BACKUP_ENTRY}`, data: json },
          { name: photo(), data: json },
        ]),
      ),
    ).toBe('entry_name_not_allowed');
    expect(
      await reasonOf(
        rawZip([
          { name: `a/${BACKUP_ENTRY}`, data: json },
          { name: `b/${photo()}`, data: json },
        ]),
      ),
    ).toBe('entry_name_not_allowed');
  });
  it('refuses a nested or traversing folder prefix', async () => {
    expect(await reasonOf(rawZip([{ name: `a/b/${BACKUP_ENTRY}`, data: json }]))).toBe(
      'entry_name_not_allowed',
    );
    expect(await reasonOf(rawZip([{ name: `../${BACKUP_ENTRY}`, data: json }]))).toBe(
      'entry_name_not_allowed',
    );
    expect(await reasonOf(rawZip([{ name: `./${BACKUP_ENTRY}`, data: json }]))).toBe(
      'entry_name_not_allowed',
    );
  });
  it('a manifest at the top is never prefix-stripped: x/backup.json next to it is refused', async () => {
    expect(await reasonOf(rawZip([manifest(), { name: `x/${BACKUP_ENTRY}`, data: json }]))).toBe(
      'entry_name_not_allowed',
    );
  });

  const python = spawnSync('python3', ['-c', 'import zipfile'], { encoding: 'utf8' });
  it.skipIf(python.status !== 0)('reads a zip made by Python zipfile (python3 -I)', async () => {
    const src = join(dir, 'py-src');
    mkdirSync(join(src, 'photos'), { recursive: true });
    writeFileSync(join(src, BACKUP_ENTRY), json);
    const out = join(dir, 'py.zip');
    const script = join(dir, 'mkzip.py');
    writeFileSync(
      script,
      [
        'import sys, zipfile',
        'src, out = sys.argv[1], sys.argv[2]',
        'with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:',
        '    z.write(src + "/backup.json", "backup.json")',
        '    z.write(src + "/photos", "photos/")',
        '',
      ].join('\n'),
    );
    const r = spawnSync('python3', ['-I', script, src, out], { encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(0);
    const zip = await openZip(out);
    expect(zip.names).toEqual([BACKUP_ENTRY]);
    expect((await zip.read(BACKUP_ENTRY)).equals(json)).toBe(true);
    await zip.close();
  });
});

describe('openZip: manifest cap (review m1)', () => {
  it('is 32 MiB: a 20 MiB manifest (over the old 16 MiB cap) opens, 33 MiB is refused', async () => {
    const mib = 1024 * 1024;
    expect(MAX_MANIFEST_BYTES).toBe(32 * mib);
    const open20 = await openZip(
      put(rawZip([{ name: BACKUP_ENTRY, data: Buffer.alloc(20 * mib) }])),
    );
    expect(open20.sizeOf(BACKUP_ENTRY)).toBe(20 * mib);
    await open20.close();
    expect(await reasonOf(rawZip([{ name: BACKUP_ENTRY, data: Buffer.alloc(33 * mib) }]))).toBe(
      'entry_too_large',
    );
  });
});

describe('openZip: hostile archives are refused as a whole', () => {
  const ok = rawZip([manifest()]);

  it('truncated: half of a valid archive', async () => {
    expect(await reasonOf(ok.subarray(0, Math.floor(ok.length / 2)))).toBe('eocd_missing');
  });
  it('truncated below the end record size', async () => {
    expect(await reasonOf(Buffer.from('PK\x05\x06'))).toBe('too_small');
  });
  it('end record missing: random bytes', async () => {
    expect(await reasonOf(Buffer.alloc(500, 7))).toBe('eocd_missing');
  });
  it('end record not at the end of the file (trailing bytes)', async () => {
    expect(await reasonOf(rawZip([manifest()], { trailing: Buffer.from('junk') }))).toBe(
      'eocd_missing',
    );
  });
  it('central directory offset past the end of the file', async () => {
    expect(await reasonOf(rawZip([manifest()], { cdOffset: 0x7fffffff }))).toBe(
      'central_directory_out_of_range',
    );
  });
  it('central directory size larger than the file', async () => {
    expect(await reasonOf(rawZip([manifest()], { cdSize: 50_000_000 }))).toBe(
      'central_directory_too_large',
    );
  });
  it('entry count lie: more than the directory holds', async () => {
    expect(await reasonOf(rawZip([manifest()], { count: 3 }))).toBe('entry_count_mismatch');
  });
  it('entry count lie: fewer than the directory holds', async () => {
    expect(await reasonOf(rawZip([manifest(), { name: photo(), data: json }], { count: 1 }))).toBe(
      'entry_count_mismatch',
    );
  });
  it('entry count over the cap', async () => {
    expect(await reasonOf(rawZip([manifest()]), { maxEntries: 0 })).toBe('too_many_entries');
  });
  it('size lie: stored entry whose compressed and uncompressed sizes differ', async () => {
    expect(await reasonOf(rawZip([manifest({ usize: 5 })]))).toBe('size_mismatch');
  });
  it('size lie: declared size smaller than what inflates (output is cut at the limit)', async () => {
    const data = Buffer.alloc(1_000_000, 1);
    const reason = await reasonOf(
      rawZip([manifest(), { name: photo(), data, method: 8, usize: 1000 }]),
      { maxRatio: 100_000 },
    );
    expect(reason).toBe('size_mismatch');
  });
  it('size lie: declared size larger than what inflates', async () => {
    const reason = await reasonOf(
      rawZip([manifest(), { name: photo(), data: Buffer.from('abcabc'), method: 8, usize: 600 }]),
      { maxRatio: 100_000 },
    );
    expect(reason).toBe('size_mismatch');
  });
  it.each([
    ['traversal', '../x'],
    ['traversal in a photo path', 'photos/../../etc/passwd'],
    ['absolute path', '/etc/passwd'],
    ['backslash', 'photos\\01HZX0000000000000000000AB.webp'],
    ['NUL byte', 'backup\0.json'],
    ['unlisted name', 'readme.txt'],
    ['lowercase ulid', 'photos/01hzx0000000000000000000ab.webp'],
    ['ulid with a forbidden letter (I)', 'photos/01HZX000000000000000000AIB.webp'],
    ['ulid one character short', 'photos/01HZX0000000000000000000A.webp'],
    ['uppercase extension', 'photos/01HZX0000000000000000000AB.WEBP'],
    ['nested path', 'photos/sub/01HZX0000000000000000000AB.webp'],
    ['trailing newline', 'photos/01HZX0000000000000000000AB.webp\n'],
    ['manifest in a folder', 'x/backup.json'],
  ])('entry name refused: %s', async (_label, name) => {
    expect(await reasonOf(rawZip([manifest(), { name, data: json }]))).toBe(
      'entry_name_not_allowed',
    );
  });
  it('non-ASCII name bytes', async () => {
    expect(
      await reasonOf(rawZip([{ name: Buffer.from([0xc3, 0xa9, 0x2e, 0x77]), data: json }])),
    ).toBe('entry_name_not_allowed');
  });
  it('duplicate names', async () => {
    expect(await reasonOf(rawZip([manifest(), manifest()]))).toBe('duplicate_entry');
  });
  it('zip bomb: ratio over the cap is refused before any inflate', async () => {
    const zeros = Buffer.alloc(10 * 1024 * 1024);
    expect(await reasonOf(rawZip([manifest(), { name: photo(), data: zeros, method: 8 }]))).toBe(
      'ratio',
    );
  });
  it('zip bomb: a lying small declared size is cut off at the declared size', async () => {
    const zeros = Buffer.alloc(50 * 1024 * 1024);
    const deflated = deflateRawSync(zeros);
    const reason = await reasonOf(
      rawZip([
        {
          name: photo(),
          data: zeros.subarray(0, 100),
          method: 8,
          rawData: deflated,
          csize: deflated.length,
          usize: 100,
          crc: 0,
        },
      ]),
      { maxRatio: 1_000_000 },
    );
    expect(reason).toBe('size_mismatch');
  });
  it('zip bomb: a lying entry is cut off, the inflater never produces much past the declared size', async () => {
    const zeros = Buffer.alloc(50 * 1024 * 1024);
    const deflated = deflateRawSync(zeros);
    inflated.bytes = 0;
    const reason = await reasonOf(
      rawZip([
        {
          name: photo(),
          data: zeros.subarray(0, 100),
          method: 8,
          rawData: deflated,
          csize: deflated.length,
          usize: 100,
          crc: 0,
        },
      ]),
      { maxRatio: 1_000_000 },
    );
    expect(reason).toBe('size_mismatch');
    expect(inflated.bytes).toBeGreaterThan(0);
    expect(inflated.bytes).toBeLessThanOrEqual(100 + 1024 * 1024);
  });
  it('entry over its size cap (manifest and photo)', async () => {
    expect(await reasonOf(rawZip([manifest()]), { maxManifestBytes: 4 })).toBe('entry_too_large');
    expect(await reasonOf(rawZip([{ name: photo(), data: json }]), { maxPhotoBytes: 4 })).toBe(
      'entry_too_large',
    );
  });
  it('total uncompressed size over the cap', async () => {
    expect(
      await reasonOf(rawZip([manifest(), { name: photo(), data: json }]), { maxTotalBytes: 20 }),
    ).toBe('archive_too_large');
  });
  it('encrypted flag (traditional and strong)', async () => {
    expect(await reasonOf(rawZip([manifest({ flags: 0x0001 })]))).toBe('encrypted');
    expect(await reasonOf(rawZip([manifest({ flags: 0x0041 })]))).toBe('encrypted');
  });
  it('ZIP64 markers: entry count, locator, and 0xFFFFFFFF sizes', async () => {
    expect(await reasonOf(rawZip([manifest()], { count: 0xffff }))).toBe('zip64');
    expect(await reasonOf(rawZip([manifest()], { zip64Locator: true }))).toBe('zip64');
    expect(await reasonOf(rawZip([manifest({ csize: 0xffffffff, usize: 0xffffffff })]))).toBe(
      'zip64',
    );
  });
  it('compression method 99 (and bzip2)', async () => {
    expect(await reasonOf(rawZip([manifest({ method: 99 })]))).toBe('unsupported_method');
    expect(await reasonOf(rawZip([manifest({ method: 12 })]))).toBe('unsupported_method');
  });
  it('local header disagrees with the central directory: name, method, crc', async () => {
    const name = photo();
    const other = photo();
    expect(await reasonOf(rawZip([{ name, data: json, localName: other }]))).toBe(
      'header_mismatch',
    );
    expect(await reasonOf(rawZip([manifest({ localMethod: 8 })]))).toBe('header_mismatch');
    expect(await reasonOf(rawZip([manifest({ localCrc: 1 })]))).toBe('header_mismatch');
  });
  it('CRC mismatch', async () => {
    expect(await reasonOf(rawZip([manifest({ crc: 0x1234 })]))).toBe('crc_mismatch');
    expect(await reasonOf(rawZip([manifest({ crc: 0x1234, method: 8 })]))).toBe('crc_mismatch');
  });
  it('overlapping entries (two central records pointing at one local header)', async () => {
    const two = rawZip([manifest(), { name: photo(), data: json }]);
    // Point the second central record at the first entry's local header.
    const eocd = two.length - 22;
    const cdStart = two.readUInt32LE(eocd + 16);
    const firstLen = 46 + BACKUP_ENTRY.length;
    two.writeUInt32LE(0, cdStart + firstLen + 42);
    expect(await reasonOf(two)).toBe('overlapping_entries');
  });
  it('entry data running into the central directory', async () => {
    expect(await reasonOf(rawZip([manifest({ csize: 5000, usize: 5000 })]))).toBe(
      'entry_out_of_range',
    );
  });
  it('corrupt deflate data', async () => {
    const bad = Buffer.alloc(40, 0xff);
    expect(
      await reasonOf(
        rawZip([{ name: photo(), data: json, method: 8, rawData: bad, csize: 40, usize: 13 }]),
        { maxRatio: 1000 },
      ),
    ).toMatch(/inflate_failed|size_mismatch/);
  });
  it('a bad central record signature', async () => {
    const z = rawZip([manifest()]);
    z.writeUInt32LE(0xdeadbeef, z.readUInt32LE(z.length - 22 + 16));
    expect(await reasonOf(z)).toBe('bad_central_record');
  });
  it('multi-disk archives', async () => {
    const z = rawZip([manifest()]);
    z.writeUInt16LE(1, z.length - 22 + 4);
    expect(await reasonOf(z)).toBe('multi_disk');
  });
});
