import type { RequestOptions } from '../types.js';

/** Iterates every item across pages, following `next_cursor` until it is null. */
export async function* paginate<P extends { cursor?: string }, Page extends { next_cursor: string | null }, I>(
  fetchPage: (params: P, options?: RequestOptions) => Promise<Page>,
  pick: (page: Page) => I[],
  params: P,
  options?: RequestOptions,
): AsyncGenerator<I, void, undefined> {
  let cursor = params.cursor;
  const seen = new Set<string>();
  for (;;) {
    const page = await fetchPage({ ...params, cursor }, options);
    for (const item of pick(page) ?? []) yield item;
    const next = page.next_cursor;
    if (!next || seen.has(next)) return;
    seen.add(next);
    cursor = next;
  }
}
