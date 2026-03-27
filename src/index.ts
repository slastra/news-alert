import type { PollGroup } from './config.ts';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DB_PATH, HAZARD_POLL_MS, POLL_INTERVALS } from './config.ts';
import { FEEDS } from './feeds.ts';
import { pollHazards } from './hazards.ts';
import { log } from './logger.ts';
import { loadNotifiers } from './notifiers/index.ts';
import { startPollGroup } from './poller.ts';
import { startServer } from './server.ts';
import { sqliteDateTime, Storage } from './storage.ts';
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

log.info(`Starting: ${FEEDS.length} feeds, ${groups.size} groups`);

// Load notification channels
loadNotifiers().catch(err => log.error('Failed to load notifiers', err));

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
log.info(`Hazards: polling every ${HAZARD_POLL_MS / 1000}s`);

// Hourly snapshot job
async function takeSnapshot() {
  try {
    const stats = storage.getStats();
    const sixHoursAgo = sqliteDateTime(new Date(Date.now() - 21600_000));
    const headlines = storage.getTopHeadlines(5, sixHoursAgo);
    const summary = await generateSummary(headlines);
    storage.saveSnapshot(stats, summary);
    log.info(`Snapshot: composite=${stats.compositeScore} articles/1h=${stats.articleRate.total.lastHour} alerts/24h=${stats.alertCount24h}`);
  }
  catch (err) {
    log.error('Snapshot failed', err);
  }
}

const snapshotInterval = setInterval(takeSnapshot, 3600_000);
intervals.push(snapshotInterval);

// Daily DB cleanup (retain 7 days)
function runCleanup() {
  try {
    storage.cleanup();
    log.info('DB cleanup: removed records older than 7 days');
  }
  catch (err) {
    log.error('DB cleanup failed', err);
  }
}

runCleanup(); // Run on startup
const cleanupInterval = setInterval(runCleanup, 86400_000);
intervals.push(cleanupInterval);

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
