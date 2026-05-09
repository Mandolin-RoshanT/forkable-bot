// Anthropic adapter for the ChatCompleter capability — wraps the official
// SDK's messages API. There's no native JSON-mode flag on Anthropic, so
// JSON-validity relies on the rubric instructing "JSON only"; the scorer's
// safeParse handles drift by returning a red-bucket sentinel.

import Anthropic from '@anthropic-ai/sdk';

import type { ChatCompleter } from './scorer.ts';

const MODEL = 'claude-haiku-4-5-20251001';
const MAX_TOKENS = 1024;

export function createAnthropicChatCompleter(creds: { apiKey: string }): ChatCompleter {
  const client = new Anthropic({ apiKey: creds.apiKey });

  return async ({ system, user }) => {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system,
      messages: [{ role: 'user', content: user }],
    });
    const block = response.content[0];
    if (!block || block.type !== 'text') {
      return '';
    }
    return block.text;
  };
}
