import { ImportError, type ImportErrorCode } from './errors';
import { extractRecipeNode } from './extract-jsonld';
import { normalizeRecipe, type Draft } from './normalize';
import { MAX_PASTE_CHARS, recipeNodeFromPaste } from './paste';
import {
  safeFetch as defaultSafeFetch,
  type SafeFetchOptions,
  type SafeFetchResult,
} from './safe-fetch';
import { normalizeSourceUrl } from './source-url';

// Orchestration for slice 3a: static fetch -> JSON-LD -> normalize, or paste. Headless
// (`method = 'headless'`) is a later slice and is never produced here. Only `safeFetch`
// touches the network; no AI/LLM and no other third-party calls.

export type ImportInput = { url: string } | { text: string };

export type ImportDeps = {
  safeFetch?: (url: string, opts?: SafeFetchOptions) => Promise<SafeFetchResult>;
  /** Passed straight to safeFetch (non-production fixture seam, from env). */
  fetchOptions?: SafeFetchOptions;
  log?: (msg: string, err?: unknown) => void;
};

export type ImportResult = {
  status: 'needs_review' | 'failed';
  method: 'static' | 'paste';
  draft: Draft | null;
  warnings: string[];
  error_code: ImportErrorCode | null;
  /** Normalized source URL for duplicate detection (null for paste). */
  source_url: string | null;
  /** Page HTML as fetched/pasted; the caller persists it only when KEEP_RAW_HTML is on. */
  raw_html: string | null;
};

function decodeBody(body: Uint8Array, contentType: string | undefined): string {
  const label = /charset\s*=\s*["']?([\w-]+)/i.exec(contentType ?? '')?.[1] ?? 'utf-8';
  try {
    return new TextDecoder(label).decode(body);
  } catch {
    return new TextDecoder('utf-8').decode(body);
  }
}

const failed = (
  method: ImportResult['method'],
  code: ImportErrorCode,
  extra: Partial<ImportResult> = {},
): ImportResult => ({
  status: 'failed',
  method,
  draft: null,
  warnings: [],
  error_code: code,
  source_url: null,
  raw_html: null,
  ...extra,
});

export async function runImport(input: ImportInput, deps: ImportDeps = {}): Promise<ImportResult> {
  const fetchPage = deps.safeFetch ?? defaultSafeFetch;

  if ('text' in input) {
    const text = input.text.slice(0, MAX_PASTE_CHARS);
    const { node, notes } = recipeNodeFromPaste(text);
    if (!node) return failed('paste', 'no_recipe', { warnings: notes });
    const { draft, warnings } = normalizeRecipe(node, { sourceUrl: null });
    if (!draft) return failed('paste', 'no_recipe', { warnings, raw_html: text });
    return {
      status: 'needs_review',
      method: 'paste',
      draft,
      warnings,
      error_code: null,
      source_url: null,
      raw_html: text,
    };
  }

  const sourceUrl = normalizeSourceUrl(input.url);
  if (!sourceUrl) return failed('static', 'invalid_url');

  let page: SafeFetchResult;
  try {
    page = await fetchPage(input.url.trim(), deps.fetchOptions);
  } catch (e) {
    if (e instanceof ImportError) {
      deps.log?.(`fetch failed: ${e.code}`, e.cause);
      return failed('static', e.code, { source_url: sourceUrl });
    }
    deps.log?.('fetch failed: unexpected', e);
    return failed('static', 'fetch_failed', { source_url: sourceUrl });
  }

  const html = decodeBody(page.body, page.headers['content-type']);
  const { node } = extractRecipeNode(html);
  const base = { source_url: sourceUrl, raw_html: html };
  if (!node) return failed('static', 'no_recipe', base);
  const { draft, warnings } = normalizeRecipe(node, { sourceUrl });
  if (!draft) return failed('static', 'no_recipe', { ...base, warnings });
  return { status: 'needs_review', method: 'static', draft, warnings, error_code: null, ...base };
}
