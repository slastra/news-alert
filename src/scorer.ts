import type { Article } from './parser.ts';
import type { Storage } from './storage.ts';
import { invokeHaiku } from './bedrock.ts';
import { LOCATION_NAME } from './config.ts';
import { log } from './logger.ts';

const ALERT_THRESHOLD = 8;

export interface ScoredArticle extends Article {
  score: number;
  reason: string;
  confirmed?: boolean;
  confirmReason?: string;
}

const UNIFIED_SCHEMA = {
  type: 'object',
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          index: { type: 'integer' },
          score: { type: 'integer' },
          reason: { type: 'string' },
          confirmed: { type: 'boolean' },
          confirmReason: { type: 'string' },
        },
        required: ['index', 'score', 'reason', 'confirmed', 'confirmReason'],
        additionalProperties: false,
      },
    },
  },
  required: ['results'],
  additionalProperties: false,
};

function formatAge(publishedAt: string): string {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(publishedAt).getTime()) / 60_000));
  if (minutes < 60)
    return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24)
    return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function buildPrompt(sentAlerts: string[]): string {
  let prompt = `You are a personal news relevance classifier for someone in ${LOCATION_NAME}. For each headline, return a score (1-10) and a confirmation flag indicating whether to send a push notification.

BIAS: When uncertain, score lower and do not confirm. Notification fatigue is the failure mode — a missed alert can be caught next cycle, but a false alarm trains the user to ignore real ones.

TIMING: Each headline shows its age in parentheses (e.g. "12m ago", "3h ago"). Older stories are usually less actionable — a tornado warning published 4 hours ago has likely expired, while one from 5 minutes ago is active. A weather forecast from 2 hours ago may be stale by now. Factor age into both score and confirmation.

SCORE BANDS (based on actionability for someone in ${LOCATION_NAME} TODAY):
- 1-3: No action needed. Default for celebrity, sports, opinion, distant non-impacting events. Score higher only if the headline names a directly actionable consequence.
- 4-5: Informational only — no behavior change needed this week (policy debates, international diplomacy, economic trends, distant conflicts).
- 6-7: May require action within days (gas/food price spikes, travel disruptions, regional severe weather forecasts, major policy changes affecting daily life).
- 8-9: Action needed now — active local/regional threats, evacuation orders, infrastructure failures, pandemic declarations affecting the US.
- 10: Reserved for civilization-scale events (nuclear war declared, asteroid impact). Almost never reachable from a news headline — local extreme threats reach the user via NWS first.

GEOGRAPHIC BINDING:
- Local = within the same metro area as ${LOCATION_NAME}.
- Regional = within ~500 miles of ${LOCATION_NAME}.
- National = US-wide impact.
- Anything else = distant.

CONFIRMATION (only when score >= 8):
- Has this event already been notified today? (See sent-alerts list below.) Two headlines describe the same event if their underlying facts overlap, regardless of wording. Duplicate => confirmed = false.
- Is the threat ACTIVE and CURRENT, not a past report or future forecast? Forecast or recap => confirmed = false.
- Does the headline specify a concrete event, location, or required action — or is it urgent-sounding without substance? Vague urgency => confirmed = false.
- If you cannot clearly answer YES to all three: confirmed = false.

For any score < 8: set confirmed = false, confirmReason = "below threshold".

EXAMPLES (anchors):
- "Hurricane forecast for Florida next week" => score 6, confirmed false, "future forecast, not active".
- "Trump assassination attempt — new details emerge" with prior alert "Trump assassination attempt at rally" => score 8, confirmed false, "duplicate of prior alert".
- "BREAKING: Markets in turmoil" => score 4, confirmed false, "vague urgency, no concrete event".
- "Tornado warning issued for ${LOCATION_NAME}" with no prior alert => score 9, confirmed true, "active local threat".

OUTPUT: A JSON object { "results": [...] } with one entry per headline, in the same index order as input. Each entry:
- "index": integer matching input
- "score": integer 1-10
- "reason": <=10 words, scoring justification
- "confirmed": boolean
- "confirmReason": <=15 words`;

  if (sentAlerts.length > 0) {
    prompt += `\n\nSENT ALERTS (last 24h — do not duplicate):\n${sentAlerts.join('\n')}`;
  }

  prompt += `\n\nHEADLINES TO SCORE:\n`;
  return prompt;
}

const BATCH_SIZE = 20;

interface ResultEntry {
  index: number;
  score: number;
  reason: string;
  confirmed: boolean;
  confirmReason: string;
}

async function scoreBatch(batch: Article[], offset: number, sentAlerts: string[]): Promise<ScoredArticle[]> {
  const headlines = batch
    .map((a, i) => {
      const head = `${i}. [${a.source}] (${formatAge(a.publishedAt)}) ${a.title}`;
      return a.description ? `${head}\n   ${a.description}` : head;
    })
    .join('\n');

  const prompt = buildPrompt(sentAlerts) + headlines;

  let results: ResultEntry[];

  try {
    const response = await invokeHaiku<{ results: ResultEntry[] }>(prompt, UNIFIED_SCHEMA, 'score-and-confirm');
    results = response.results;
  }
  catch (err) {
    log.error(`Haiku scoring failed (batch at offset ${offset})`, err);
    return batch.map(a => ({
      ...a,
      score: 0,
      reason: 'scoring failed',
      confirmed: false,
      confirmReason: 'scoring failed',
    }));
  }

  return batch.map((article, i) => {
    const entry = results.find(r => r.index === i);
    return {
      ...article,
      score: entry?.score ?? 0,
      reason: entry?.reason ?? 'no score returned',
      confirmed: entry?.confirmed ?? false,
      confirmReason: entry?.confirmReason ?? 'no result returned',
    };
  });
}

export async function scoreArticles(articles: Article[], storage: Storage): Promise<ScoredArticle[]> {
  if (articles.length === 0)
    return [];

  const sentAlerts = storage.getSentAlerts24h();

  const scored: ScoredArticle[] = [];
  for (let i = 0; i < articles.length; i += BATCH_SIZE) {
    const batch = articles.slice(i, i + BATCH_SIZE);
    const results = await scoreBatch(batch, i, sentAlerts);
    scored.push(...results);
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
