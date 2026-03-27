import type { Storage } from './storage.ts';
import { SERVER_PORT } from './config.ts';
import { log } from './logger.ts';
import { sqliteDateTime } from './storage.ts';

const ALLOWED_ORIGIN = 'https://shaun.lastra.us';

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function jsonResponse(data: unknown): Response {
  return Response.json(data, { headers: corsHeaders() });
}

export function startServer(storage: Storage): void {
  Bun.serve({
    port: SERVER_PORT,
    async fetch(req) {
      const url = new URL(req.url);

      if (req.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: corsHeaders() });
      }

      if (url.pathname === '/health') {
        return new Response('ok', { status: 200 });
      }

      if (url.pathname === '/status') {
        const stats = storage.getStats();
        return jsonResponse(stats);
      }

      if (url.pathname === '/summary') {
        const cached = storage.getLatestSummary();
        return jsonResponse(cached ?? { summary: null, generatedAt: null, topArticles: [] });
      }

      if (url.pathname === '/history') {
        const now = sqliteDateTime(new Date());
        const twentyFourHoursAgo = sqliteDateTime(new Date(Date.now() - 86400_000));
        const from = url.searchParams.get('from') ?? twentyFourHoursAgo;
        const to = url.searchParams.get('to') ?? now;
        const snapshots = storage.getHistory(from, to);
        return jsonResponse(snapshots);
      }

      if (url.pathname === '/hazards') {
        const hazards = storage.getRecentHazards();
        return jsonResponse(hazards);
      }

      return new Response('Not Found', { status: 404, headers: corsHeaders() });
    },
  });

  log.info(`Status server listening on http://localhost:${SERVER_PORT}/status`);
}
