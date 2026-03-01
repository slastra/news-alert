import type { FeedCache } from './storage.ts';
import { REQUEST_TIMEOUT_MS, USER_AGENT } from './config.ts';

export interface FetchResult {
  status: number;
  body: string | null;
  etag: string | null;
  lastModified: string | null;
}

export async function fetchFeed(url: string, cache?: FeedCache | null): Promise<FetchResult> {
  const headers: Record<string, string> = {
    'User-Agent': USER_AGENT,
    'Accept': 'application/rss+xml, application/xml, text/xml, */*',
  };

  if (cache?.etag) {
    headers['If-None-Match'] = cache.etag;
  }
  if (cache?.lastModified) {
    headers['If-Modified-Since'] = cache.lastModified;
  }

  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    redirect: 'follow',
  });

  if (response.status === 304) {
    return {
      status: 304,
      body: null,
      etag: cache?.etag ?? null,
      lastModified: cache?.lastModified ?? null,
    };
  }

  const body = await response.text();
  return {
    status: response.status,
    body,
    etag: response.headers.get('etag'),
    lastModified: response.headers.get('last-modified'),
  };
}
