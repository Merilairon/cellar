import { ImportError, type ImportErrorCode } from './errors';
import { extractRecipeNode } from './extract-jsonld';
import { attachMapping, type MapFn } from './mapping';
import { normalizeRecipe, type Draft } from './normalize';
import { MAX_PASTE_CHARS, recipeNodeFromPaste } from './paste';
import {
  safeFetch as defaultSafeFetch,
  type SafeFetchOptions,
  type SafeFetchResult,
} from './safe-fetch';
import type { Headless, HeadlessPage } from './headless-client';
import { normalizeSourceUrl, storedSourceUrl } from './source-url';

// Orchestration: static fetch -> JSON-LD -> normalize, then (URL imports only, at most once,
// only when HEADLESS_URL is configured) the headless sidecar for pages with no Recipe or an
// HTTP 401/403/429, then paste. `processHtml` is shared so static and headless cannot diverge.
// Only `safeFetch` and the headless client touch the network; no AI/LLM and no other
// third-party calls. This file never reads env: the headless handle arrives through deps.

export type ImportInput = { url: string } | { text: string };

export type ImportDeps = {
  safeFetch?: (url: string, opts?: SafeFetchOptions) => Promise<SafeFetchResult>;
  /** Passed straight to safeFetch (non-production fixture seam, from env). */
  fetchOptions?: SafeFetchOptions;
  log?: (msg: string, err?: unknown) => void;
  /** Test seam: replaces the auto-mapper. Never exposed to request data. */
  mapGrid?: MapFn;
  /** Headless sidecar handle, built from env by the route. Absent = disabled. */
  headless?: Headless;
};

export type ImportResult = {
  status: 'needs_review' | 'failed';
  method: 'static' | 'headless' | 'paste';
  draft: Draft | null;
  warnings: string[];
  error_code: ImportErrorCode | null;
  /** Normalized source URL for duplicate detection (null for paste). */
  source_url: string | null;
  /** Page HTML as fetched/pasted; the caller persists it only when KEEP_RAW_HTML is on. */
  raw_html: string | null;
  /**
   * `used`: the rendered page produced the result. `unavailable`: headless was needed but is
   * off or failed (the UI explains and offers paste). Not persisted; `used` is derivable
   * from `method`.
   */
  headless?: 'used' | 'unavailable' | null;
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
    let parsed: ReturnType<typeof normalizeRecipe>;
    try {
      const { node, notes } = recipeNodeFromPaste(text);
      if (!node) return failed('paste', 'no_recipe', { warnings: notes });
      parsed = normalizeRecipe(node, { sourceUrl: null });
    } catch (e) {
      deps.log?.('parse failed: unexpected', e);
      return failed('paste', 'no_recipe');
    }
    if (!parsed.draft)
      return failed('paste', 'no_recipe', { warnings: parsed.warnings, raw_html: text });
    const mapped = attachMapping(parsed.draft, parsed.mapInput, {
      mapGrid: deps.mapGrid,
      log: deps.log,
    });
    return {
      status: 'needs_review',
      method: 'paste',
      draft: mapped.draft,
      warnings: [...parsed.warnings, ...mapped.warnings],
      error_code: null,
      source_url: null,
      raw_html: text,
    };
  }

  // Comparison key (duplicate detection, job.url) and the URL to store (entered scheme, Q3).
  const sourceUrl = normalizeSourceUrl(input.url);
  const storedUrl = storedSourceUrl(input.url);
  if (!sourceUrl || !storedUrl) return failed('static', 'invalid_url');

  let page: SafeFetchResult | null = null;
  let staticError: ImportErrorCode | null = null;
  try {
    page = await fetchPage(input.url.trim(), deps.fetchOptions);
  } catch (e) {
    if (e instanceof ImportError) {
      deps.log?.(`fetch failed: ${e.code}`, e.cause);
      staticError = e.code;
    } else {
      deps.log?.('fetch failed: unexpected', e);
      staticError = 'fetch_failed';
    }
  }

  let staticFail: ImportResult;
  let tryHeadless = false;
  if (page) {
    const html = decodeBody(page.body, page.headers['content-type']);
    const out = processHtml(html, 'static', {
      sourceUrl,
      storedUrl,
      baseUrl: page.finalUrl,
      deps,
    });
    if (out.result.status === 'needs_review') return out.result;
    staticFail = out.result;
    // Trigger table (G4): a page without any Recipe node is a JS-only candidate. A node that
    // normalized to nothing is not: the data is there and rendering will not fix it.
    tryHeadless = out.noRecipeNode;
  } else {
    staticFail = failed('static', staticError ?? 'fetch_failed', { source_url: sourceUrl });
    // 401/403/429 only. Timeouts, size, URL and address problems and plain fetch errors never.
    tryHeadless = staticError === 'blocked';
  }
  if (!tryHeadless) return staticFail;

  const headless = deps.headless;
  if (!headless?.enabled) return { ...staticFail, headless: 'unavailable' };

  // At most once per job.
  let rendered: HeadlessPage;
  try {
    rendered = await headless.render(input.url.trim());
  } catch (e) {
    const code = e instanceof ImportError ? e.code : 'headless_unavailable';
    deps.log?.(`headless failed: ${code}`, e instanceof Error ? e.cause : undefined);
    return failed('headless', code, {
      source_url: sourceUrl,
      headless: code === 'headless_unavailable' ? 'unavailable' : null,
    });
  }
  const out = processHtml(rendered.html, 'headless', {
    sourceUrl,
    storedUrl,
    baseUrl: rendered.finalUrl,
    deps,
  });
  if (out.result.status === 'needs_review') {
    return {
      ...out.result,
      warnings: [...out.result.warnings, 'headless_used'],
      headless: 'used',
    };
  }
  return { ...out.result, headless: 'used' };
}

/**
 * Shared by the static and headless paths so they cannot diverge:
 * extractRecipeNode -> normalizeRecipe -> attachMapping. `noRecipeNode` tells the caller
 * whether the page had no Recipe at all (the headless trigger).
 */
function processHtml(
  html: string,
  method: 'static' | 'headless',
  ctx: { sourceUrl: string; storedUrl: string; baseUrl: string; deps: ImportDeps },
): { result: ImportResult; noRecipeNode: boolean } {
  const { deps } = ctx;
  const base = { source_url: ctx.sourceUrl, raw_html: html };
  let node: ReturnType<typeof extractRecipeNode>['node'];
  let normalized: ReturnType<typeof normalizeRecipe> | null = null;
  try {
    node = extractRecipeNode(html).node;
    // Relative cover URLs resolve against where the page really is (final URL after redirects).
    if (node)
      normalized = normalizeRecipe(node, { sourceUrl: ctx.storedUrl, baseUrl: ctx.baseUrl });
  } catch (e) {
    deps.log?.('parse failed: unexpected', e);
    return { result: failed(method, 'no_recipe', base), noRecipeNode: false };
  }
  if (!node || !normalized)
    return { result: failed(method, 'no_recipe', base), noRecipeNode: true };
  if (!normalized.draft)
    return {
      result: failed(method, 'no_recipe', { ...base, warnings: normalized.warnings }),
      noRecipeNode: false,
    };
  const mapped = attachMapping(normalized.draft, normalized.mapInput, {
    mapGrid: deps.mapGrid,
    log: deps.log,
  });
  return {
    result: {
      status: 'needs_review',
      method,
      draft: mapped.draft,
      warnings: [...normalized.warnings, ...mapped.warnings],
      error_code: null,
      ...base,
    },
    noRecipeNode: false,
  };
}
