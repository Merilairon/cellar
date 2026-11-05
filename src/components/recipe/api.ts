/** fetch wrapper for same-origin JSON calls: network failure resolves to null instead of throwing. */
export async function call(url: string, method: string, body?: unknown): Promise<Response | null> {
  try {
    return await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    return null;
  }
}

/** The URL if it is http(s), else null (never render javascript: links). */
export function safeHttpUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return /^https?:$/.test(new URL(value).protocol) ? value : null;
  } catch {
    return null;
  }
}
