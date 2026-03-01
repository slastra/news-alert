import { invokeHaiku } from './bedrock.ts';
import { log } from './logger.ts';

interface Headline {
  title: string;
  source: string;
  score: number;
}

const SUMMARY_PROMPT = `You are a concise news briefing assistant. Given these top news headlines from the last hour, write a 2-3 sentence summary focusing on the most important events. Be factual and succinct — no filler or commentary.

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
    const raw = await invokeHaiku(SUMMARY_PROMPT + formatted);
    return raw.trim();
  }
  catch (err) {
    log.error('Summary generation failed', err);
    return null;
  }
}
