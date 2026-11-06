/** Import error codes (data-model import_job.error_code). */
export const IMPORT_ERROR_CODES = [
  'blocked',
  'no_recipe',
  'timeout',
  'invalid_url',
  'private_address',
  'too_large',
  'fetch_failed',
  // Headless sidecar unreachable, busy, misconfigured or failing (v0.3.2). Never carries details.
  'headless_unavailable',
] as const;
export type ImportErrorCode = (typeof IMPORT_ERROR_CODES)[number];

/**
 * Carries only a stable code. The message is fixed per code so that no resolved IP,
 * response body or internal error text can leak to a client; details go in `cause`
 * (server-side logging only, never serialized into responses).
 */
export class ImportError extends Error {
  readonly code: ImportErrorCode;
  constructor(code: ImportErrorCode, cause?: unknown) {
    super(`import_error:${code}`, cause === undefined ? undefined : { cause });
    this.name = 'ImportError';
    this.code = code;
  }
}
