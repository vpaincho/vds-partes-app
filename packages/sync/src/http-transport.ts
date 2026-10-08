/**
 * The real transport: `fetch` against `/sync/commands`.
 *
 * Deliberately the only place in this package that touches the network, so `sync.ts`'s bookkeeping
 * can be tested with a fake transport and no server at all.
 */
import type { SyncTransport } from './sync.ts';

export function httpTransport(options: { baseUrl: string; getToken: () => string | null }): SyncTransport {
  return {
    async postBatch(items) {
      const token = options.getToken();
      const response = await fetch(`${options.baseUrl}/sync/commands`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ commands: items }),
      });
      const text = await response.text();
      const parsed = text === '' ? null : JSON.parse(text);
      if (!response.ok) {
        throw new Error(`/sync/commands respondió ${response.status}`);
      }
      return parsed as Awaited<ReturnType<SyncTransport['postBatch']>>;
    },
  };
}
