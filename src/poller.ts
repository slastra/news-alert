import type { FeedConfig } from './feeds.ts';
import type { Article } from './parser.ts';
import type { Storage } from './storage.ts';
import { fetchFeed } from './fetcher.ts';
import { log } from './logger.ts';
import { parseRssFeed } from './parser.ts';
import { logScoredArticles, scoreArticles } from './scorer.ts';

async function fetchNewArticles(feed: FeedConfig, storage: Storage): Promise<Article[]> {
  const cache = storage.getCache(feed.url);

  let result;
  try {
    result = await fetchFeed(feed.url, cache);
  }
  catch (err) {
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      log.warn(`${feed.name}: request timed out`);
    }
    else {
      log.error(`${feed.name}: fetch failed`, err);
    }
    return [];
  }

  if (result.status === 304)
    return [];

  if (result.status !== 200 || !result.body) {
    log.warn(`${feed.name}: HTTP ${result.status}`);
    return [];
  }

  let articles;
  try {
    articles = parseRssFeed(result.body, feed.name, feed.url);
  }
  catch (err) {
    log.error(`${feed.name}: parse failed`, err);
    return [];
  }

  // Update conditional request cache
  storage.setCache(feed.url, result.etag, result.lastModified);

  if (articles.length === 0)
    return [];

  const newArticles = storage.filterNew(articles);

  if (newArticles.length > 0) {
    for (const article of newArticles) {
      log.article(article.source, article.title, article.url);
    }
    storage.markSeen(newArticles);
  }

  return newArticles;
}

export function startPollGroup(
  groupName: string,
  feeds: FeedConfig[],
  intervalMs: number,
  storage: Storage,
): ReturnType<typeof setInterval> {
  const tick = async () => {
    // Collect new articles across all feeds in this group
    const allNew: Article[] = [];

    for (const feed of feeds) {
      try {
        const newArticles = await fetchNewArticles(feed, storage);
        allNew.push(...newArticles);
      }
      catch (err) {
        log.error(`Unexpected error polling ${feed.name}`, err);
      }
    }

    // Batch score all new articles in one API call
    if (allNew.length > 0) {
      try {
        log.info(`Scoring ${allNew.length} articles (${groupName})`);
        const scored = await scoreArticles(allNew, storage);
        await logScoredArticles(scored);
        storage.saveScores(scored);
      }
      catch (err) {
        log.error(`Scoring failed for ${groupName} group`, err);
      }
    }
  };

  log.info(`Poll group ${groupName}: ${feeds.length} feeds, every ${intervalMs / 1000}s`);

  // Run immediately on startup
  tick();

  return setInterval(tick, intervalMs);
}
