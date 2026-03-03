import type { Article } from './parser.ts';
import type { Storage } from './storage.ts';
import { invokeHaiku, invokeNemotron } from './bedrock.ts';
import { LOCATION_NAME } from './config.ts';
import { log } from './logger.ts';

const ALERT_THRESHOLD = 8;

export interface ScoredArticle extends Article {
  score: number;
  reason: string;
  confirmed?: boolean;
  confirmReason?: string;
}

const SCORING_SCHEMA = {
  type: 'object',
  properties: {
    scores: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          index: { type: 'integer' },
          score: { type: 'integer' },
          reason: { type: 'string' },
        },
        required: ['index', 'score', 'reason'],
        additionalProperties: false,
      },
    },
  },
  required: ['scores'],
  additionalProperties: false,
};

const CONFIRM_SCHEMA = {
  type: 'object',
  properties: {
    confirmed: { type: 'boolean' },
    reason: { type: 'string' },
  },
  required: ['confirmed', 'reason'],
  additionalProperties: false,
};

const SCORING_PROMPT = `You are a personal news relevance classifier. Score each headline 1-10 based on whether a person in ${LOCATION_NAME} should take action or change behavior as a result.

1-3: No action needed (celebrity, sports, opinion, distant events with no local impact)
4-5: Worth knowing but no action (policy changes, international diplomacy, economic trends)
6-7: Might affect decisions soon (gas/food price spikes, travel disruptions, regional severe weather forecasts, major policy changes affecting daily life)
8-9: Action needed now (local severe weather warnings, nearby active threats, infrastructure failures, evacuation orders, pandemic declarations affecting the US)
10: Immediate personal danger (tornado on the ground nearby, nuclear incident, active threat in the area)

Score based on ACTIONABILITY — would this headline cause a reasonable person to do something different today? Distant wars, foreign disasters, and political drama score low unless they directly impact daily life (e.g. gas prices, supply chains, travel).

Respond with a JSON object containing a "scores" array. Each element must have:
- "index": the article number (starting at 0)
- "score": integer 1-10
- "reason": brief explanation (10 words max)

Articles to score:
`;

function buildConfirmPrompt(sentAlerts: string[]): string {
  let prompt = `You are a personal alert verification system. An article was flagged as potentially actionable (score 8+/10) for someone in ${LOCATION_NAME}. Confirm whether this truly requires them to take action or change behavior.

Consider:
- Does this require the person to DO something (shelter, evacuate, avoid an area, prepare, change plans)?
- Is the threat ACTIVE and CURRENT, not just reporting on past events?
- Is this geographically relevant (local, regional, or nationally impactful)?
- Could this be clickbait or sensationalized?
- Has a notification ALREADY been sent for this same event? If so, do NOT confirm — avoid duplicate alerts.`;

  if (sentAlerts.length > 0) {
    prompt += `\n\nNotifications already sent today:\n${sentAlerts.join('\n')}`;
  }

  prompt += `\n\nRespond with a JSON object containing "confirmed" (boolean) and "reason" (brief explanation, 15 words max).

Article headline: `;

  return prompt;
}

const BATCH_SIZE = 20;

interface ScoreEntry {
  index: number;
  score: number;
  reason: string;
}

async function scoreBatch(batch: Article[], offset: number): Promise<ScoredArticle[]> {
  const headlines = batch
    .map((a, i) => `${i}. [${a.source}] ${a.title}`)
    .join('\n');

  let scores: ScoreEntry[];

  try {
    const result = await invokeNemotron<{ scores: ScoreEntry[] }>(SCORING_PROMPT + headlines, SCORING_SCHEMA, 'scoring');
    scores = result.scores;
  }
  catch (err) {
    log.error(`Nemotron scoring failed (batch at offset ${offset})`, err);
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
      const result = await invokeHaiku<{ confirmed: boolean; reason: string }>(
        `${confirmPrompt}"${article.title}" (${article.source})`,
        CONFIRM_SCHEMA,
        'confirmation',
      );
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
  const { notify } = await import('./notifiers/index.ts');

  for (const a of articles) {
    if (a.score >= ALERT_THRESHOLD && a.confirmed) {
      log.info(`ALERT [${a.score}/10] ${a.source}: "${a.title}" (${a.confirmReason})`);
      await notify({
        title: `[${a.score}/10] ${a.source}`,
        body: `${a.title}\n\n${a.confirmReason}`,
        url: a.url,
        priority: a.score >= 9 ? 'urgent' : 'high',
        source: a.source,
      });
    }
    else if (a.score >= ALERT_THRESHOLD) {
      log.info(`HIGH [${a.score}/10] ${a.source}: "${a.title}" (${a.confirmReason})`);
    }
    else if (a.score >= 6) {
      log.info(`[${a.score}/10] ${a.source}: "${a.title}"`);
    }
    // 1-5: silent, only logged as [NEW] by the poller
  }
}

export { ALERT_THRESHOLD };
