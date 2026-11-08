import { describe, expect, it } from 'vitest';
import { contentTypeFor, PHOTO_MAX_BYTES, precheck, uploadErrorFor } from './photo-upload';

const f = (name: string, type: string, size = 1000) => ({ name, type, size });

describe('precheck', () => {
  it('accepts jpeg, png, webp by type', () => {
    for (const t of ['image/jpeg', 'image/png', 'image/webp']) {
      expect(precheck(f('a', t))).toBeNull();
    }
  });
  it('falls back to the extension when the browser gives no type', () => {
    expect(contentTypeFor(f('IMG_1.JPG', ''))).toBe('image/jpeg');
    expect(precheck(f('x.webp', ''))).toBeNull();
  });
  it('rejects other types and unknown extensions without a request', () => {
    expect(precheck(f('a.svg', 'image/svg+xml'))).toEqual({ key: 'unsupported', retry: false });
    expect(precheck(f('a.gif', 'image/gif'))?.key).toBe('unsupported');
    expect(precheck(f('notes.txt', ''))?.key).toBe('unsupported');
  });
  it('rejects more than 10 MiB, allows exactly 10 MiB', () => {
    expect(precheck(f('a.png', 'image/png', PHOTO_MAX_BYTES + 1))?.key).toBe('tooLarge');
    expect(precheck(f('a.png', 'image/png', PHOTO_MAX_BYTES))).toBeNull();
  });
});

describe('uploadErrorFor', () => {
  it('maps statuses', () => {
    expect(uploadErrorFor(413, null).key).toBe('tooLarge');
    expect(uploadErrorFor(415, null).key).toBe('unsupported');
    expect(uploadErrorFor(503, null)).toEqual({ key: 'busy', retry: true });
    expect(uploadErrorFor(429, null)).toEqual({ key: 'busy', retry: true });
    for (const s of [401, 403, 404])
      expect(uploadErrorFor(s, null)).toEqual({ key: 'forbidden', retry: false });
    expect(uploadErrorFor(0, null)).toEqual({ key: 'network', retry: true });
    expect(uploadErrorFor(500, null)).toEqual({ key: 'network', retry: true });
    expect(uploadErrorFor(408, null).retry).toBe(true);
  });
  it('maps 422 codes', () => {
    const body = (code: string) => ({ errors: [{ path: 'file', code }] });
    expect(uploadErrorFor(422, body('unsupported_type')).key).toBe('unsupported');
    expect(uploadErrorFor(422, body('invalid_image')).key).toBe('invalid');
    expect(uploadErrorFor(422, body('empty_file')).key).toBe('invalid');
    expect(uploadErrorFor(422, body('too_many_pixels')).key).toBe('tooManyPixels');
    expect(uploadErrorFor(422, body('photo_limit')).key).toBe('limit');
    expect(uploadErrorFor(422, body('something_new')).key).toBe('invalid');
    expect(uploadErrorFor(422, null).key).toBe('invalid');
  });
});
