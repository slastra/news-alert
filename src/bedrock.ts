import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

const REGION = 'us-east-1';
export const NOVA_MODEL = 'amazon.nova-lite-v1:0';
export const HAIKU_MODEL = 'us.anthropic.claude-haiku-4-5-20251001-v1:0';

const client = new BedrockRuntimeClient({ region: REGION });

interface NovaResponse {
  output: { message: { content: { text: string }[] } };
}

interface HaikuResponse {
  content: { text: string }[];
}

export async function invokeNova(prompt: string): Promise<string> {
  const command = new InvokeModelCommand({
    modelId: NOVA_MODEL,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify({
      messages: [{ role: 'user', content: [{ text: prompt }] }],
      inferenceConfig: { maxTokens: 4096, temperature: 0 },
    }),
  });

  const response = await client.send(command);
  const body = JSON.parse(new TextDecoder().decode(response.body)) as NovaResponse;
  return body.output.message.content[0]?.text ?? '';
}

export async function invokeHaiku(prompt: string, retries = 3): Promise<string> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const command = new InvokeModelCommand({
        modelId: HAIKU_MODEL,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify({
          anthropic_version: 'bedrock-2023-05-31',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 256,
          temperature: 0,
        }),
      });

      const response = await client.send(command);
      const body = JSON.parse(new TextDecoder().decode(response.body)) as HaikuResponse;
      return body.content[0]?.text ?? '';
    }
    catch (err) {
      const isThrottled = err instanceof Error && err.message.includes('Too many requests');
      if (isThrottled && attempt < retries) {
        const delay = 1000 * (attempt + 1);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
  throw new Error('Exhausted retries');
}

export function extractJSON(text: string): string {
  const match = text.match(/```(?:json)?\n([\s\S]*?)```/);
  if (match)
    return match[1]!.trim();
  const jsonMatch = text.match(/[[{][\s\S]*[\]}]/);
  return jsonMatch ? jsonMatch[0] : text;
}
