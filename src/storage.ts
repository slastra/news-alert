import type { Article } from './parser.ts';
import type { ScoredArticle } from './scorer.ts';
import { Database } from 'bun:sqlite';

/** Format a Date to match SQLite's datetime('now') format: YYYY-MM-DD HH:MM:SS */
export function sqliteDateTime(date: Date): string {
  return date.toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
}

export interface FeedCache {
  etag: string | null;
  lastModified: string | null;
}

export interface StatusResponse {
  compositeScore: number;
  articleRate: {
    total: { lastHour: number; last24h: number };
    bySource: Record<string, { lastHour: number; last24h: number }>;
  };
  alertCount24h: number;
  topArticles: {
    score: number;
    source: string;
    title: string;
    url: string;
    reason: string;
    confirmed: boolean;
    confirmReason: string | null;
    scoredAt: string;
  }[];
  feedHealth: Record<string, { lastFetched: string; status: string }>;
}

export class Storage {
  private db: Database;
  private stmtIsNew: ReturnType<Database['prepare']>;
  private stmtInsert: ReturnType<Database['prepare']>;
  private stmtGetCache: ReturnType<Database['prepare']>;
  private stmtSetCache: ReturnType<Database['prepare']>;
  private stmtInsertScore: ReturnType<Database['prepare']>;
  private stmtIsHazardSeen: ReturnType<Database['prepare']>;
  private stmtInsertHazard: ReturnType<Database['prepare']>;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.run('PRAGMA journal_mode = WAL');
    this.db.run('PRAGMA busy_timeout = 5000');

    this.db.run(`
      CREATE TABLE IF NOT EXISTS seen_articles (
        guid TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        title TEXT NOT NULL,
        url TEXT NOT NULL,
        published_at TEXT,
        first_seen_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS feed_cache (
        feed_url TEXT PRIMARY KEY,
        etag TEXT,
        last_modified TEXT,
        last_fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);

    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_seen_articles_first_seen
        ON seen_articles(first_seen_at)
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS article_scores (
        guid TEXT PRIMARY KEY,
        score INTEGER NOT NULL,
        reason TEXT,
        confirmed INTEGER,
        confirm_reason TEXT,
        scored_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY(guid) REFERENCES seen_articles(guid)
      )
    `);

    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_article_scores_scored_at
        ON article_scores(scored_at)
    `);

    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_article_scores_score
        ON article_scores(score)
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS status_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        recorded_at TEXT NOT NULL DEFAULT (datetime('now')),
        composite_score REAL NOT NULL,
        article_count_1h INTEGER NOT NULL,
        article_count_24h INTEGER NOT NULL,
        alert_count_24h INTEGER NOT NULL,
        summary TEXT,
        snapshot_json TEXT NOT NULL
      )
    `);

    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_status_snapshots_recorded_at
        ON status_snapshots(recorded_at)
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS seen_hazards (
        source_type TEXT NOT NULL,
        source_id TEXT NOT NULL,
        title TEXT NOT NULL,
        severity TEXT,
        first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (source_type, source_id)
      )
    `);

    this.stmtIsNew = this.db.prepare('SELECT 1 FROM seen_articles WHERE guid = ?');
    this.stmtInsert = this.db.prepare(`
      INSERT OR IGNORE INTO seen_articles (guid, source, title, url, published_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    this.stmtInsertScore = this.db.prepare(`
      INSERT OR REPLACE INTO article_scores (guid, score, reason, confirmed, confirm_reason)
      VALUES (?, ?, ?, ?, ?)
    `);
    this.stmtIsHazardSeen = this.db.prepare('SELECT 1 FROM seen_hazards WHERE source_type = ? AND source_id = ?');
    this.stmtInsertHazard = this.db.prepare(`
      INSERT OR IGNORE INTO seen_hazards (source_type, source_id, title, severity)
      VALUES (?, ?, ?, ?)
    `);
    this.stmtGetCache = this.db.prepare('SELECT etag, last_modified FROM feed_cache WHERE feed_url = ?');
    this.stmtSetCache = this.db.prepare(`
      INSERT INTO feed_cache (feed_url, etag, last_modified, last_fetched_at)
      VALUES (?, ?, ?, datetime('now'))
      ON CONFLICT(feed_url) DO UPDATE SET
        etag = excluded.etag,
        last_modified = excluded.last_modified,
        last_fetched_at = excluded.last_fetched_at
    `);
  }

  filterNew(articles: Article[]): Article[] {
    return articles.filter(a => !this.stmtIsNew.get(a.guid));
  }

  markSeen(articles: Article[]): void {
    const tx = this.db.transaction(() => {
      for (const a of articles) {
        this.stmtInsert.run(a.guid, a.source, a.title, a.url, a.publishedAt);
      }
    });
    tx();
  }

  getCache(feedUrl: string): FeedCache | null {
    const row = this.stmtGetCache.get(feedUrl) as { etag: string | null; last_modified: string | null } | null;
    if (!row)
      return null;
    return { etag: row.etag, lastModified: row.last_modified };
  }

  setCache(feedUrl: string, etag: string | null, lastModified: string | null): void {
    this.stmtSetCache.run(feedUrl, etag, lastModified);
  }

  saveScores(articles: ScoredArticle[]): void {
    const tx = this.db.transaction(() => {
      for (const a of articles) {
        this.stmtInsertScore.run(
          a.guid,
          a.score,
          a.reason,
          a.confirmed == null ? null : (a.confirmed ? 1 : 0),
          a.confirmReason ?? null,
        );
      }
    });
    tx();
  }

  getStats(): StatusResponse {
    const oneHourAgo = sqliteDateTime(new Date(Date.now() - 3600_000));
    const twentyFourHoursAgo = sqliteDateTime(new Date(Date.now() - 86400_000));

    // Article rate — total
    const totalLastHour = (this.db.query(
      'SELECT COUNT(*) as count FROM seen_articles WHERE first_seen_at >= ?',
    ).get(oneHourAgo) as { count: number }).count;

    const totalLast24h = (this.db.query(
      'SELECT COUNT(*) as count FROM seen_articles WHERE first_seen_at >= ?',
    ).get(twentyFourHoursAgo) as { count: number }).count;

    // Article rate — by source
    const sourceRows1h = this.db.query(
      'SELECT source, COUNT(*) as count FROM seen_articles WHERE first_seen_at >= ? GROUP BY source ORDER BY count DESC',
    ).all(oneHourAgo) as { source: string; count: number }[];

    const sourceRows24h = this.db.query(
      'SELECT source, COUNT(*) as count FROM seen_articles WHERE first_seen_at >= ? GROUP BY source ORDER BY count DESC',
    ).all(twentyFourHoursAgo) as { source: string; count: number }[];

    const bySource: Record<string, { lastHour: number; last24h: number }> = {};
    for (const row of sourceRows24h) {
      bySource[row.source] = { lastHour: 0, last24h: row.count };
    }
    for (const row of sourceRows1h) {
      const existing = bySource[row.source];
      if (existing) {
        existing.lastHour = row.count;
      }
      else {
        bySource[row.source] = { lastHour: row.count, last24h: row.count };
      }
    }

    // Composite score — top-10 average from last hour
    const topScores = this.db.query(
      'SELECT score FROM article_scores WHERE scored_at >= ? ORDER BY score DESC LIMIT 10',
    ).all(oneHourAgo) as { score: number }[];

    const compositeScore = topScores.length > 0
      ? Math.round((topScores.reduce((sum, r) => sum + r.score, 0) / topScores.length) * 10) / 10
      : 0;

    // Alert count — confirmed 8+ in last 24h
    const alertCount24h = (this.db.query(
      'SELECT COUNT(*) as count FROM article_scores WHERE score >= 8 AND confirmed = 1 AND scored_at >= ?',
    ).get(twentyFourHoursAgo) as { count: number }).count;

    // Top articles — highest scored in last 24h
    const topArticles = this.db.query(`
      SELECT s.score, a.source, a.title, a.url, s.reason, s.confirmed, s.confirm_reason, s.scored_at
      FROM article_scores s
      JOIN seen_articles a ON s.guid = a.guid
      WHERE s.scored_at >= ?
      ORDER BY s.score DESC, s.scored_at DESC
      LIMIT 10
    `).all(twentyFourHoursAgo) as {
      score: number;
      source: string;
      title: string;
      url: string;
      reason: string;
      confirmed: number | null;
      confirm_reason: string | null;
      scored_at: string;
    }[];

    // Feed health
    const feedRows = this.db.query(
      'SELECT feed_url, last_fetched_at FROM feed_cache',
    ).all() as { feed_url: string; last_fetched_at: string }[];

    const feedHealth: Record<string, { lastFetched: string; status: string }> = {};
    for (const row of feedRows) {
      const lastFetched = new Date(row.last_fetched_at);
      const staleMinutes = (Date.now() - lastFetched.getTime()) / 60_000;
      feedHealth[row.feed_url] = {
        lastFetched: row.last_fetched_at,
        status: staleMinutes > 10 ? 'stale' : 'ok',
      };
    }

    return {
      compositeScore,
      articleRate: {
        total: { lastHour: totalLastHour, last24h: totalLast24h },
        bySource,
      },
      alertCount24h,
      topArticles: topArticles.map(a => ({
        score: a.score,
        source: a.source,
        title: a.title,
        url: a.url,
        reason: a.reason,
        confirmed: a.confirmed === 1,
        confirmReason: a.confirm_reason,
        scoredAt: a.scored_at,
      })),
      feedHealth,
    };
  }

  isHazardSeen(sourceType: string, sourceId: string): boolean {
    return !!this.stmtIsHazardSeen.get(sourceType, sourceId);
  }

  markHazardSeen(sourceType: string, sourceId: string, title: string, severity: string): void {
    this.stmtInsertHazard.run(sourceType, sourceId, title, severity);
  }

  getRecentHazards(): { sourceType: string; sourceId: string; title: string; severity: string | null; firstSeenAt: string }[] {
    const twentyFourHoursAgo = sqliteDateTime(new Date(Date.now() - 86400_000));
    const rows = this.db.query(`
      SELECT source_type, source_id, title, severity, first_seen_at
      FROM seen_hazards
      WHERE first_seen_at >= ?
      ORDER BY first_seen_at DESC
    `).all(twentyFourHoursAgo) as { source_type: string; source_id: string; title: string; severity: string | null; first_seen_at: string }[];

    return rows.map(r => ({
      sourceType: r.source_type,
      sourceId: r.source_id,
      title: r.title,
      severity: r.severity,
      firstSeenAt: r.first_seen_at,
    }));
  }

  getSentAlerts24h(): string[] {
    const twentyFourHoursAgo = sqliteDateTime(new Date(Date.now() - 86400_000));

    // Confirmed news alerts
    const newsAlerts = this.db.query(`
      SELECT a.title, a.source
      FROM article_scores s
      JOIN seen_articles a ON s.guid = a.guid
      WHERE s.score >= 8 AND s.confirmed = 1 AND s.scored_at >= ?
      ORDER BY s.scored_at DESC
    `).all(twentyFourHoursAgo) as { title: string; source: string }[];

    // Hazard alerts
    const hazardAlerts = this.db.query(`
      SELECT title, source_type
      FROM seen_hazards
      WHERE first_seen_at >= ?
      ORDER BY first_seen_at DESC
    `).all(twentyFourHoursAgo) as { title: string; source_type: string }[];

    const lines: string[] = [];
    for (const a of newsAlerts) {
      lines.push(`[News] ${a.source}: ${a.title}`);
    }
    for (const h of hazardAlerts) {
      lines.push(`[Hazard/${h.source_type}] ${h.title}`);
    }
    return lines;
  }

  getTopHeadlines(minScore: number, sinceDateISO: string): { title: string; source: string; score: number; url: string }[] {
    return this.db.query(`
      SELECT a.title, a.source, s.score, a.url
      FROM article_scores s
      JOIN seen_articles a ON s.guid = a.guid
      WHERE s.score >= ? AND s.scored_at >= ?
      ORDER BY s.score DESC, s.scored_at DESC
      LIMIT 15
    `).all(minScore, sinceDateISO) as { title: string; source: string; score: number; url: string }[];
  }

  saveSnapshot(stats: StatusResponse, summary: string | null): void {
    this.db.query(
      `INSERT INTO status_snapshots (composite_score, article_count_1h, article_count_24h, alert_count_24h, summary, snapshot_json)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      stats.compositeScore,
      stats.articleRate.total.lastHour,
      stats.articleRate.total.last24h,
      stats.alertCount24h,
      summary,
      JSON.stringify(stats),
    );
  }

  getHistory(from: string, to: string): { recordedAt: string; compositeScore: number; articleCount1h: number; alertCount24h: number; summary: string | null }[] {
    const rows = this.db.query(`
      SELECT recorded_at, composite_score, article_count_1h, alert_count_24h, summary
      FROM status_snapshots
      WHERE recorded_at >= ? AND recorded_at <= ?
      ORDER BY recorded_at DESC
    `).all(from, to) as { recorded_at: string; composite_score: number; article_count_1h: number; alert_count_24h: number; summary: string | null }[];

    return rows.map(r => ({
      recordedAt: r.recorded_at,
      compositeScore: r.composite_score,
      articleCount1h: r.article_count_1h,
      alertCount24h: r.alert_count_24h,
      summary: r.summary,
    }));
  }

  close(): void {
    this.db.close();
  }
}
