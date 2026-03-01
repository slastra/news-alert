import { XMLParser } from 'fast-xml-parser';

export interface Article {
  guid: string;
  title: string;
  url: string;
  publishedAt: string;
  source: string;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  trimValues: true,
  parseTagValue: false,
  removeNSPrefix: true,
});

function extractText(value: unknown): string | null {
  if (typeof value === 'string')
    return value.trim();
  if (typeof value === 'number')
    return String(value);
  // Handle arrays (e.g. NYT has multiple <link> elements) — take first string
  if (Array.isArray(value)) {
    for (const v of value) {
      const result = extractText(v);
      if (result)
        return result;
    }
    return null;
  }
  if (typeof value === 'object' && value !== null && '#text' in value) {
    return String((value as Record<string, unknown>)['#text']).trim();
  }
  return null;
}

function normalizeItem(item: Record<string, unknown>, source: string, isLemmy: boolean): Article | null {
  const title = extractText(item.title);
  if (!title)
    return null;

  // URL: for Lemmy, prefer enclosure URL (actual article) over link (discussion)
  const link = extractText(item.link);
  const enclosure = item.enclosure as Record<string, unknown> | undefined;
  const enclosureUrl = enclosure?.['@_url'] as string | undefined;
  const url = (isLemmy && enclosureUrl) ? enclosureUrl : (link || enclosureUrl || null);
  if (!url)
    return null;

  // GUID: prefer <guid>, fall back to URL
  const guid = extractText(item.guid) || url;

  // Published date
  const pubDate = extractText(item.pubDate);
  let publishedAt: string;
  if (pubDate) {
    const parsed = new Date(pubDate);
    publishedAt = Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
  }
  else {
    publishedAt = new Date().toISOString();
  }

  return { guid, title, url, publishedAt, source };
}

export function parseRssFeed(xml: string, source: string, feedUrl: string): Article[] {
  const parsed = parser.parse(xml) as Record<string, unknown>;
  const isLemmy = feedUrl.includes('lemmy.');

  // Handle RSS 2.0 (rss.channel.item) and Atom (feed.entry)
  const rss = parsed.rss as Record<string, unknown> | undefined;
  const channel = rss?.channel as Record<string, unknown> | undefined;
  const rawItems = channel?.item;

  if (!rawItems)
    return [];

  const items = Array.isArray(rawItems) ? rawItems : [rawItems];
  return items
    .map(item => normalizeItem(item as Record<string, unknown>, source, isLemmy))
    .filter((a): a is Article => a !== null);
}
