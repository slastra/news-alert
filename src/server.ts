import type { Storage } from './storage.ts';
import { SERVER_PORT } from './config.ts';
import { log } from './logger.ts';
import { generateSummary } from './summarizer.ts';

export function startServer(storage: Storage): void {
  Bun.serve({
    port: SERVER_PORT,
    async fetch(req) {
      const url = new URL(req.url);

      if (url.pathname === '/status') {
        const stats = storage.getStats();
        return Response.json(stats);
      }

      if (url.pathname === '/summary') {
        const oneHourAgo = new Date(Date.now() - 3600_000).toISOString();
        const headlines = storage.getTopHeadlines(5, oneHourAgo);
        const summary = await generateSummary(headlines);
        return Response.json({
          summary,
          generatedAt: new Date().toISOString(),
          topArticles: headlines,
        });
      }

      if (url.pathname === '/history') {
        const now = new Date().toISOString();
        const twentyFourHoursAgo = new Date(Date.now() - 86400_000).toISOString();
        const from = url.searchParams.get('from') ?? twentyFourHoursAgo;
        const to = url.searchParams.get('to') ?? now;
        const snapshots = storage.getHistory(from, to);
        return Response.json(snapshots);
      }

      if (url.pathname === '/hazards') {
        const hazards = storage.getRecentHazards();
        return Response.json(hazards);
      }

      return new Response('Not Found', { status: 404 });
    },
  });

  log.info(`Status server listening on http://localhost:${SERVER_PORT}/status`);
}
