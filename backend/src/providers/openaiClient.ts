import OpenAI from 'openai';
import type { ChatCompletionResponse, CreateChatCompletion } from './openai';

/**
 * Wires the OpenAI SDK to the one call the analyzer makes. The only file that
 * imports the SDK, so nothing else needs a key or a network to be tested.
 *
 * Timeout and retries are the SDK's: it backs off with jitter and retries only
 * statuses worth retrying, so a malformed request is not paid for twice.
 */
export function openAiChatCompletion(apiKey: string, timeoutMs = 20_000): CreateChatCompletion {
  const client = new OpenAI({ apiKey, timeout: timeoutMs, maxRetries: 2 });

  // The SDK's request and response types are wider than the single shape used here;
  // this adapter is the boundary where that is narrowed.
  return async (request) =>
    (await client.chat.completions.create(request as never)) as unknown as ChatCompletionResponse;
}
