import type { PollGroup } from './config.ts';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DB_PATH, HAZARD_POLL_MS, POLL_INTERVALS } from './config.ts';
import { FEEDS } from './feeds.ts';
import { pollHazards } from './hazards.ts';
import { log } from './logger.ts';
import { startPollGroup } from './poller.ts';
import { startServer } from './server.ts';
import { Storage } from './storage.ts';
import { generateSummary } from './summarizer.ts';

// Ensure data directory exists
mkdirSync(path.dirname(DB_PATH), { recursive: true });

const storage = new Storage(DB_PATH);
const intervals: ReturnType<typeof setInterval>[] = [];

// Group feeds by poll group
const groups = new Map<PollGroup, typeof FEEDS>();
for (const feed of FEEDS) {
  const group = groups.get(feed.group) ?? [];
  group.push(feed);
  groups.set(feed.group, group);
}

log.info(`news-alert starting with ${FEEDS.length} feeds across ${groups.size} poll groups`);

// Start HTTP status server
startServer(storage);

// Start each poll group
for (const [group, feeds] of groups) {
  const interval = startPollGroup(group, feeds, POLL_INTERVALS[group], storage);
  intervals.push(interval);
}

// Hazard monitoring (weather, earthquakes, volcanoes, space weather)
pollHazards(storage); // Initial poll on startup
const hazardInterval = setInterval(() => pollHazards(storage), HAZARD_POLL_MS);
intervals.push(hazardInterval);
log.info(`Hazard monitoring started (every ${HAZARD_POLL_MS / 1000}s)`);

// Hourly snapshot job
async function takeSnapshot() {
  try {
    const stats = storage.getStats();
    const oneHourAgo = new Date(Date.now() - 3600_000).toISOString();
    const headlines = storage.getTopHeadlines(5, oneHourAgo);
    const summary = await generateSummary(headlines);
    storage.saveSnapshot(stats, summary);
    log.info(`Snapshot saved — composite: ${stats.compositeScore}, articles/1h: ${stats.articleRate.total.lastHour}, alerts/24h: ${stats.alertCount24h}`);
  }
  catch (err) {
    log.error('Snapshot failed', err);
  }
}

const snapshotInterval = setInterval(takeSnapshot, 3600_000);
intervals.push(snapshotInterval);

// Graceful shutdown
function cleanup() {
  log.info('Shutting down...');
  for (const interval of intervals) {
    clearInterval(interval);
  }
  storage.close();
  // eslint-disable-next-line node/prefer-global/process
  process.exit(0);
}

// eslint-disable-next-line node/prefer-global/process
process.on('SIGINT', cleanup);
// eslint-disable-next-line node/prefer-global/process
process.on('SIGTERM', cleanup);
