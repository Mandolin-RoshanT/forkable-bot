// LLMScorer: maps a MealCandidate → Score via any provider that satisfies
// the ChatCompleter capability. The class is provider-agnostic — pick a
// provider via createScorer(settings.scorer, logger).
//
// Production wires up either OpenAI or Anthropic via the matching adapter
// in this directory; tests inject a fake completer and assert behavior
// without touching the network.

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Settings } from '../config.ts';
import type { Logger } from '../logger.ts';
import { type MealCandidate, type Score, ScoreSchema } from '../models.ts';
import { createAnthropicChatCompleter } from './anthropic-completer.ts';
import { createOpenAIChatCompleter } from './openai-completer.ts';

const RUBRIC_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'rubric.md');

export type ChatCompleter = (input: { system: string; user: string }) => Promise<string>;

// Failure sentinel — every scoring error path returns one of these so the
// picker still has something to bucket-rank for the day.
function redScore(reasoning: string): Score {
  return { bucket: 'red', reasoning };
}

export class LLMScorer {
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
      return redScore(`scorer error: ${msg}`);
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

// Top-level factory — picks the right ChatCompleter based on the
// configured provider and wraps it in an LLMScorer.
export function createScorer(config: Settings['scorer'], logger: Logger): LLMScorer {
  switch (config.provider) {
    case 'openai':
      return new LLMScorer(createOpenAIChatCompleter({ apiKey: config.apiKey }), logger);
    case 'anthropic':
      return new LLMScorer(createAnthropicChatCompleter({ apiKey: config.apiKey }), logger);
  }
}
