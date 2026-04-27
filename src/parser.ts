import { XMLParser } from 'fast-xml-parser';

export interface Article {
  guid: string;
  title: string;
  url: string;
  publishedAt: string;
  source: string;
  description?: string;
}

const DESCRIPTION_MAX_LEN = 400;

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

function stripHtml(input: string): string {
  return input
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&#39;/g, '\'')
    .replace(/&apos;/g, '\'')
    .replace(/&[a-z]+;/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractDescription(item: Record<string, unknown>, title: string): string | undefined {
  // Prefer <description>; fall back to <content:encoded> (namespace stripped to "encoded")
  const raw = extractText(item.description) ?? extractText(item.encoded);
  if (!raw)
    return undefined;

  const cleaned = stripHtml(raw);
  if (!cleaned)
    return undefined;

  // Skip if description is just the title verbatim (some feeds do this)
  if (cleaned.toLowerCase() === title.toLowerCase())
    return undefined;

  if (cleaned.length <= DESCRIPTION_MAX_LEN)
    return cleaned;

  // Truncate at the last sentence boundary within the cap, falling back to a hard cut.
  const truncated = cleaned.slice(0, DESCRIPTION_MAX_LEN);
  const lastBoundary = Math.max(truncated.lastIndexOf('. '), truncated.lastIndexOf('? '), truncated.lastIndexOf('! '));
  return lastBoundary > DESCRIPTION_MAX_LEN / 2
    ? `${truncated.slice(0, lastBoundary + 1)}`
    : `${truncated.trimEnd()}…`;
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

  const description = extractDescription(item, title);

  return { guid, title, url, publishedAt, source, description };
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
