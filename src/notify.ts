import type { ScoredArticle } from './scorer.ts';
import { NTFY_TOPIC } from './config.ts';
import { log } from './logger.ts';

export async function sendAlert(article: ScoredArticle): Promise<void> {
  try {
    await fetch(NTFY_TOPIC, {
      method: 'POST',
      headers: {
        Title: `[${article.score}/10] ${article.source}`,
        Priority: article.score >= 9 ? 'urgent' : 'high',
        Tags: article.score >= 9 ? 'rotating_light,warning' : 'warning',
        Click: article.url,
      },
      body: `${article.title}\n\n${article.confirmReason}`,
    });
    log.info(`Notification sent for: "${article.title}"`);
  }
  catch (err) {
    log.error(`Failed to send notification for "${article.title}"`, err);
  }
}
