import type { Article } from './parser.ts';
import type { Storage } from './storage.ts';
import { extractJSON, invokeHaiku, invokeNova } from './bedrock.ts';
import { log } from './logger.ts';

const ALERT_THRESHOLD = 8;

export interface ScoredArticle extends Article {
  score: number;
  reason: string;
  confirmed?: boolean;
  confirmReason?: string;
}

const SCORING_PROMPT = `You are a news severity classifier. Score each article headline from 1-10 based on how critical/urgent the event is:

1-3: Routine (celebrity, sports, lifestyle, local interest, opinion pieces)
4-5: Notable (policy changes, business news, elections, legal proceedings)
6-7: Significant (major international incidents, large protests, economic crises, significant military movements)
8-9: Critical (active armed conflicts, major terrorist attacks, natural disasters with mass casualties, nuclear incidents)
10: Existential (nuclear war, pandemic declarations, war between major world powers)

Score based on the EVENT described, not how well-written the headline is. Breaking news about ongoing crises should score based on the severity of the crisis itself.

Respond with ONLY a JSON array. Each element must have:
- "index": the article number (starting at 0)
- "score": integer 1-10
- "reason": brief explanation (10 words max)

Articles to score:
`;

function buildConfirmPrompt(sentAlerts: string[]): string {
  let prompt = `You are a critical news verification system. An article was flagged as potentially critical (score 8+/10). Your job is to confirm whether this truly warrants an emergency alert.

Consider:
- Is this an ACTIVE emergency or just reporting/analysis of past events?
- Does the headline describe real-world harm at scale (deaths, destruction, immediate danger)?
- Could this be clickbait or sensationalized?
- Has a notification ALREADY been sent for this same event? If so, do NOT confirm — avoid duplicate alerts.`;

  if (sentAlerts.length > 0) {
    prompt += `\n\nNotifications already sent today:\n${sentAlerts.join('\n')}`;
  }

  prompt += `\n\nRespond with ONLY JSON:
{
  "confirmed": true/false,
  "reason": "brief explanation (15 words max)"
}

Article headline: `;

  return prompt;
}

const BATCH_SIZE = 20;

async function scoreBatch(batch: Article[], offset: number): Promise<ScoredArticle[]> {
  const headlines = batch
    .map((a, i) => `${i}. [${a.source}] ${a.title}`)
    .join('\n');

  let scores: { index: number; score: number; reason: string }[];

  try {
    const raw = await invokeNova(SCORING_PROMPT + headlines);
    const cleaned = extractJSON(raw);
    scores = JSON.parse(cleaned) as typeof scores;
  }
  catch (err) {
    log.error(`Nova scoring failed (batch at offset ${offset})`, err);
    return batch.map(a => ({ ...a, score: 0, reason: 'scoring failed' }));
  }

  return batch.map((article, i) => {
    const scoreEntry = scores.find(s => s.index === i);
    return {
      ...article,
      score: scoreEntry?.score ?? 0,
      reason: scoreEntry?.reason ?? 'no score returned',
    };
  });
}

export async function scoreArticles(articles: Article[], storage: Storage): Promise<ScoredArticle[]> {
  if (articles.length === 0)
    return [];

  // Score in batches to avoid output truncation
  const scored: ScoredArticle[] = [];
  for (let i = 0; i < articles.length; i += BATCH_SIZE) {
    const batch = articles.slice(i, i + BATCH_SIZE);
    const results = await scoreBatch(batch, i);
    scored.push(...results);
  }

  // Confirm high-scoring articles with Haiku
  const critical = scored.filter(a => a.score >= ALERT_THRESHOLD);
  if (critical.length === 0)
    return scored;

  const sentAlerts = storage.getSentAlerts24h();
  const confirmPrompt = buildConfirmPrompt(sentAlerts);

  for (const article of critical) {
    try {
      const raw = await invokeHaiku(`${confirmPrompt}"${article.title}" (${article.source})`);
      const cleaned = extractJSON(raw);
      const result = JSON.parse(cleaned) as { confirmed: boolean; reason: string };
      article.confirmed = result.confirmed;
      article.confirmReason = result.reason;
    }
    catch (err) {
      log.error(`Haiku confirmation failed for "${article.title}"`, err);
      article.confirmed = false;
      article.confirmReason = 'confirmation failed';
    }
  }

  return scored;
}

export async function logScoredArticles(articles: ScoredArticle[]): Promise<void> {
  const { sendAlert } = await import('./notify.ts');

  for (const a of articles) {
    if (a.score >= ALERT_THRESHOLD && a.confirmed) {
      log.info(`🚨 ALERT [${a.score}/10] ${a.source}: "${a.title}" — ${a.reason} (confirmed: ${a.confirmReason})`);
      await sendAlert(a);
    }
    else if (a.score >= ALERT_THRESHOLD) {
      log.info(`⚠️  HIGH [${a.score}/10] ${a.source}: "${a.title}" — ${a.reason} (not confirmed: ${a.confirmReason})`);
    }
    else if (a.score >= 6) {
      log.info(`📰 [${a.score}/10] ${a.source}: "${a.title}" — ${a.reason}`);
    }
    // 1-5: silent, only logged as [NEW] by the poller
  }
}

export { ALERT_THRESHOLD };
