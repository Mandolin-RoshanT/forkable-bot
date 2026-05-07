// OpenAIScorer: maps a MealCandidate → Score via gpt-4o-mini.
//
// The class is a pure function over a `ChatCompleter` capability — production
// uses createOpenAIScorer() to wire up the real OpenAI SDK; tests inject a
// fake completer and assert behavior without touching the network.

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import OpenAI from 'openai';

import type { Logger } from '../logger.ts';
import { type MealCandidate, type Score, ScoreSchema } from '../models.ts';

const RUBRIC_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'rubric.md');

const MODEL = 'gpt-4o-mini';

export type ChatCompleter = (input: { system: string; user: string }) => Promise<string>;

// Failure sentinel — every scoring error path returns one of these so the
// picker still has something to bucket-rank for the day.
function redScore(reasoning: string): Score {
  return { bucket: 'red', reasoning };
}

export class OpenAIScorer {
  private rubric: string | null = null;

  constructor(
    private readonly chat: ChatCompleter,
    private readonly logger: Logger,
  ) {}

  async score(candidate: MealCandidate): Promise<Score> {
    const system = await this.loadRubric();
    const user = JSON.stringify(candidate);

    let raw: string;
    try {
      raw = await this.chat({ system, user });
    } catch (err) {
      const msg = (err as Error).message;
      this.logger.error(`scoring "${candidate.name}" failed: ${msg}`);
      return redScore(`OpenAI error: ${msg}`);
    }

    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      this.logger.error(`scoring "${candidate.name}" returned invalid JSON: ${raw.slice(0, 200)}`);
      return redScore('parse failed: invalid JSON');
    }

    const parsed = ScoreSchema.safeParse(json);
    if (!parsed.success) {
      this.logger.error(`scoring "${candidate.name}" failed schema check: ${parsed.error.message}`);
      return redScore(`parse failed: ${parsed.error.message}`);
    }
    return parsed.data;
  }

  private async loadRubric(): Promise<string> {
    if (this.rubric === null) {
      this.rubric = await Bun.file(RUBRIC_PATH).text();
    }
    return this.rubric;
  }
}

// Production factory — wires up the real OpenAI SDK behind ChatCompleter.
export function createOpenAIScorer(creds: { apiKey: string }, logger: Logger): OpenAIScorer {
  const client = new OpenAI({ apiKey: creds.apiKey });

  const chat: ChatCompleter = async ({ system, user }) => {
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

  return new OpenAIScorer(chat, logger);
}
