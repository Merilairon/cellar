import { describe, expect, it } from 'vitest';
import { config } from '@/proxy';

// The proxy buffers and silently truncates matched request bodies at proxyClientMaxBodySize
// (11 MiB, verified live on Next 16.4.5). The restore upload is larger, so it must stay outside
// the matcher, and nothing else that matters may fall out of it with it.
const re = new RegExp(`^${config.matcher[0]}$`);

describe('proxy matcher and the restore upload', () => {
  it('does not match the restore routes', () => {
    for (const p of [
      '/api/import/backup',
      '/api/import/backup/01HZX0000000000000000000AB',
      '/api/import/backup/01HZX0000000000000000000AB/apply',
    ]) {
      expect(re.test(p), p).toBe(false);
    }
  });
  it('still matches every other path, including look-alikes', () => {
    for (const p of [
      '/',
      '/backup',
      '/api/import',
      '/api/import/abc/save',
      '/api/import/backups',
      '/api/import/backupx',
      '/api/recipes/1/photos',
      '/api/import/backup-x',
      '/api/export',
      '/api/recipes/x/photos',
    ]) {
      expect(re.test(p), p).toBe(true);
    }
  });
  it('still skips static assets', () => {
    expect(re.test('/_next/static/a.js')).toBe(false);
    expect(re.test('/favicon.ico')).toBe(false);
  });
});
