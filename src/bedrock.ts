import type { ConverseCommandOutput } from '@aws-sdk/client-bedrock-runtime';
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';

const REGION = 'us-east-1';
export const NEMOTRON_MODEL = 'nvidia.nemotron-nano-9b-v2';
export const HAIKU_MODEL = 'us.anthropic.claude-haiku-4-5-20251001-v1:0';

const client = new BedrockRuntimeClient({ region: REGION });

function extractText(response: ConverseCommandOutput): string {
  const output = response.output;
  if (output && 'message' in output && output.message?.content) {
    for (const block of output.message.content) {
      if ('text' in block && block.text)
        return block.text;
    }
  }
  return '';
}

export async function invokeNemotron<T>(prompt: string, schema: Record<string, unknown>, name: string): Promise<T> {
  const command = new ConverseCommand({
    modelId: NEMOTRON_MODEL,
    messages: [{ role: 'user', content: [{ text: prompt }] }],
    inferenceConfig: { maxTokens: 4096, temperature: 0 },
    outputConfig: {
      textFormat: {
        type: 'json_schema',
        structure: { jsonSchema: { schema: JSON.stringify(schema), name } },
      },
    },
  });

  const response = await client.send(command);
  return JSON.parse(extractText(response)) as T;
}

export async function invokeHaiku<T>(prompt: string, schema: Record<string, unknown>, name: string, retries = 3): Promise<T> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const command = new ConverseCommand({
        modelId: HAIKU_MODEL,
        messages: [{ role: 'user', content: [{ text: prompt }] }],
        inferenceConfig: { maxTokens: 256, temperature: 0 },
        outputConfig: {
          textFormat: {
            type: 'json_schema',
            structure: { jsonSchema: { schema: JSON.stringify(schema), name } },
          },
        },
      });

      const response = await client.send(command);
      return JSON.parse(extractText(response)) as T;
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

export async function invokeHaikuText(prompt: string, retries = 3): Promise<string> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const command = new ConverseCommand({
        modelId: HAIKU_MODEL,
        messages: [{ role: 'user', content: [{ text: prompt }] }],
        inferenceConfig: { maxTokens: 256, temperature: 0 },
      });

      const response = await client.send(command);
      return extractText(response);
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
