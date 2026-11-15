import { randomBytes } from 'node:crypto';

/** 16 random bytes (128 bits) as unpadded base64url: always 22 characters. */
export const SHARE_TOKEN_RE = /^[A-Za-z0-9_-]{22}$/;

export function generateShareToken(): string {
  return randomBytes(16).toString('base64url');
}

/** Public URL of a share link. `BASE_URL` has no trailing slash by schema; trimmed anyway. */
export function shareUrl(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/r/${token}`;
}
