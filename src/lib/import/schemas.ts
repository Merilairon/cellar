import { z } from 'zod';
import { IMPORT_ERROR_CODES } from './errors';

// Shared by client and server: no node or db imports here.

export const MAX_IMPORT_URL = 2048;
export const MAX_IMPORT_TEXT = 500_000;

/**
 * Exactly one of `url` or `text`. Unknown keys are refused, so a request can never smuggle
 * fetch options (allowLocal, resolver, ...) in: those come from getEnv() only.
 * A syntactically bad URL is not a 422: the pipeline reports it as a failed job with
 * `invalid_url`, so the UI handles every URL problem the same way.
 */
export const importRequestSchema = z
  .object({
    url: z.string().trim().min(1).max(MAX_IMPORT_URL).optional(),
    text: z.string().min(1).max(MAX_IMPORT_TEXT).optional(),
  })
  .strict()
  .refine((v) => (v.url === undefined) !== (v.text === undefined), {
    message: 'exactly_one_of_url_or_text',
  });

export const saveRequestSchema = z.object({ import_cover: z.boolean().default(false) });

export type ImportErrorCodeValue = (typeof IMPORT_ERROR_CODES)[number];

export type ImportJobResponse = {
  id: string;
  status: 'queued' | 'fetching' | 'parsed' | 'needs_review' | 'failed' | 'saved';
  method: 'static' | 'headless' | 'paste' | null;
  draft: unknown | null;
  warnings: string[];
  error_code: ImportErrorCodeValue | null;
  /** 3b field; always null in 3a. */
  confidence: null;
  duplicate: { recipe_id: string; title: string } | null;
};
