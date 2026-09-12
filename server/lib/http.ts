/**
 * Thin fetch helper used by every integration client. Centralises timeouts and
 * JSON handling so individual clients only describe endpoints.
 */

export interface JsonResponse<T> {
  ok: boolean;
  status: number;
  body: T | null;
  text: string;
}

export interface JsonRequestInit {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
}

export async function requestJson<T>(url: string, init: JsonRequestInit = {}): Promise<JsonResponse<T>> {
  const headers: Record<string, string> = { Accept: 'application/json', ...init.headers };
  let body: string | undefined;
  if (init.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(init.body);
  }
  const res = await fetch(url, {
    method: init.method ?? 'GET',
    headers,
    body,
    signal: AbortSignal.timeout(init.timeoutMs ?? 20_000),
  });
  const text = await res.text();
  let parsed: T | null = null;
  if (text) {
    try {
      parsed = JSON.parse(text) as T;
    } catch {
      parsed = null;
    }
  }
  return { ok: res.ok, status: res.status, body: parsed, text };
}

/** Runs `worker` over `items` with at most `limit` in flight. Preserves input order in the result. */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index] as T, index);
    }
  });
  await Promise.all(runners);
  return results;
}
