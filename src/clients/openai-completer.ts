// OpenAI adapter for the ChatCompleter capability — wraps the official
// SDK's chat.completions API. JSON output is enforced via response_format.

import OpenAI from 'openai';

import type { ChatCompleter } from './scorer.ts';

const MODEL = 'gpt-4o-mini';

export function createOpenAIChatCompleter(creds: { apiKey: string }): ChatCompleter {
  const client = new OpenAI({ apiKey: creds.apiKey });

  return async ({ system, user }) => {
    const completion = await client.chat.completions.create({
      model: MODEL,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    });
    return completion.choices[0]?.message?.content ?? '';
  };
}
