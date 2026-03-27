import { invokeHaikuText } from './bedrock.ts';
import { LOCATION_NAME } from './config.ts';
import { log } from './logger.ts';

interface Headline {
  title: string;
  source: string;
  score: number;
}

const SUMMARY_PROMPT = `You are a concise news briefing assistant for someone in ${LOCATION_NAME}. Given these top news headlines from the last 6 hours, write a 2-3 sentence summary focusing on the most important events.

Prioritize higher-scored headlines — a score-9 headline should dominate over a score-5. If multiple headlines cover the same event from different angles, synthesize them into a single coherent point. Be factual and succinct — no filler or commentary.

Headlines:
`;

export async function generateSummary(headlines: Headline[]): Promise<string | null> {
  if (headlines.length === 0) {
    log.info('No headlines available for summary');
    return null;
  }

  const formatted = headlines
    .map(h => `- [${h.score}/10] [${h.source}] ${h.title}`)
    .join('\n');

  try {
    const raw = await invokeHaikuText(SUMMARY_PROMPT + formatted);
    return raw.trim();
  }
  catch (err) {
    log.error('Summary generation failed', err);
    return null;
  }
}
