// Unit tests for OpenAIScorer. We inject a fake ChatCompleter so no real
// OpenAI calls happen and the tests are deterministic.

import { describe, expect, test } from 'bun:test';

import { type ChatCompleter, OpenAIScorer } from '../../src/clients/openai-scorer.ts';
import type { LogData, Logger } from '../../src/logger.ts';
import type { MealCandidate } from '../../src/models.ts';
import { silentLogger } from '../fixtures/msw.ts';

type RecordedLog = {
  level: 'info' | 'warn' | 'error' | 'debug';
  event: string;
  data: LogData | undefined;
};

function recordingLogger(): { logger: Logger; lines: RecordedLog[] } {
  const lines: RecordedLog[] = [];
  const logger: Logger = {
    info: (event, data) => lines.push({ level: 'info', event, data }),
    warn: (event, data) => lines.push({ level: 'warn', event, data }),
    error: (event, data) => lines.push({ level: 'error', event, data }),
    debug: (event, data) => lines.push({ level: 'debug', event, data }),
  };
  return { logger, lines };
}

const sampleCandidate: MealCandidate = {
  name: 'Chicken and Broccoli Bowl',
  description: 'Grilled chicken over broccoli and quinoa',
  price: 16,
  ingredientTags: ['poultry'],
  dietLevel: 4,
};

function fakeCompleter(response: string): ChatCompleter {
  return async () => response;
}

describe('OpenAIScorer', () => {
  test('parses a valid green response', async () => {
    const scorer = new OpenAIScorer(
      fakeCompleter(JSON.stringify({ bucket: 'green', reasoning: 'lean protein + veg' })),
      silentLogger,
    );
    const score = await scorer.score(sampleCandidate);
    expect(score.bucket).toBe('green');
    expect(score.reasoning).toBe('lean protein + veg');
  });

  test('parses a valid red response', async () => {
    const scorer = new OpenAIScorer(
      fakeCompleter(JSON.stringify({ bucket: 'red', reasoning: 'fried + carbs' })),
      silentLogger,
    );
    const score = await scorer.score(sampleCandidate);
    expect(score.bucket).toBe('red');
  });

  test('falls back to red when the response is not JSON', async () => {
    const scorer = new OpenAIScorer(fakeCompleter('not json at all'), silentLogger);
    const score = await scorer.score(sampleCandidate);
    expect(score.bucket).toBe('red');
    expect(score.reasoning).toMatch(/parse failed: invalid JSON/);
  });

  test('falls back to red when the JSON has the wrong shape', async () => {
    const scorer = new OpenAIScorer(
      fakeCompleter(JSON.stringify({ verdict: 'green', why: 'nope' })),
      silentLogger,
    );
    const score = await scorer.score(sampleCandidate);
    expect(score.bucket).toBe('red');
    expect(score.reasoning).toMatch(/parse failed/);
  });

  test('falls back to red when bucket is not in the enum', async () => {
    const scorer = new OpenAIScorer(
      fakeCompleter(JSON.stringify({ bucket: 'blue', reasoning: 'invented color' })),
      silentLogger,
    );
    const score = await scorer.score(sampleCandidate);
    expect(score.bucket).toBe('red');
    expect(score.reasoning).toMatch(/parse failed/);
  });

  test('falls back to red when the OpenAI call throws', async () => {
    const failingCompleter: ChatCompleter = async () => {
      throw new Error('rate limit exceeded');
    };
    const scorer = new OpenAIScorer(failingCompleter, silentLogger);
    const score = await scorer.score(sampleCandidate);
    expect(score.bucket).toBe('red');
    expect(score.reasoning).toMatch(/OpenAI error: rate limit exceeded/);
  });

  test('passes only the relevant fields to the LLM (no IDs)', async () => {
    let capturedUser = '';
    const captureCompleter: ChatCompleter = async ({ user }) => {
      capturedUser = user;
      return JSON.stringify({ bucket: 'green', reasoning: 'ok' });
    };
    const scorer = new OpenAIScorer(captureCompleter, silentLogger);
    await scorer.score(sampleCandidate);

    const sent = JSON.parse(capturedUser) as Record<string, unknown>;
    expect(Object.keys(sent).sort()).toEqual(
      ['description', 'dietLevel', 'ingredientTags', 'name', 'price'].sort(),
    );
  });

  test('includes the rubric as the system message', async () => {
    let capturedSystem = '';
    const captureCompleter: ChatCompleter = async ({ system }) => {
      capturedSystem = system;
      return JSON.stringify({ bucket: 'green', reasoning: 'ok' });
    };
    const scorer = new OpenAIScorer(captureCompleter, silentLogger);
    await scorer.score(sampleCandidate);

    expect(capturedSystem).toContain('green');
    expect(capturedSystem).toContain('yellow');
    expect(capturedSystem).toContain('red');
  });

  describe('structured error logging', () => {
    test('network failure log carries error name + message + candidate', async () => {
      const { logger, lines } = recordingLogger();
      const failingCompleter: ChatCompleter = async () => {
        const err = new TypeError('rate limit exceeded');
        throw err;
      };
      const scorer = new OpenAIScorer(failingCompleter, logger);
      await scorer.score(sampleCandidate);

      const errLine = lines.find((l) => l.event === 'scorer.network_failed');
      expect(errLine).toBeDefined();
      expect(errLine?.level).toBe('error');
      expect(errLine?.data?.candidate).toBe(sampleCandidate.name);
      expect(errLine?.data?.name).toBe('TypeError');
      expect(errLine?.data?.message).toBe('rate limit exceeded');
    });

    test('invalid-JSON log carries the SyntaxError detail and a raw preview', async () => {
      const { logger, lines } = recordingLogger();
      const scorer = new OpenAIScorer(fakeCompleter('not json at all'), logger);
      await scorer.score(sampleCandidate);

      const errLine = lines.find((l) => l.event === 'scorer.invalid_json');
      expect(errLine).toBeDefined();
      expect(errLine?.data?.candidate).toBe(sampleCandidate.name);
      expect(errLine?.data?.rawPreview).toBe('not json at all');
      // Bun's JSON.parse throws a SyntaxError; the detail should land in the log.
      expect(errLine?.data?.name).toBe('SyntaxError');
      expect(errLine?.data?.message).toBeDefined();
    });

    test('schema-failure log lists the zod issue paths so drift is one line to diagnose', async () => {
      const { logger, lines } = recordingLogger();
      const scorer = new OpenAIScorer(
        fakeCompleter(JSON.stringify({ verdict: 'green', why: 'nope' })),
        logger,
      );
      await scorer.score(sampleCandidate);

      const errLine = lines.find((l) => l.event === 'scorer.schema_failed');
      expect(errLine).toBeDefined();
      expect(errLine?.data?.candidate).toBe(sampleCandidate.name);
      // Zod will report both `bucket` and `reasoning` as missing fields.
      const paths = errLine?.data?.issuePaths as string[];
      expect(paths).toContain('bucket');
      expect(paths).toContain('reasoning');
    });

    test('non-Error throws still produce a structured log line', async () => {
      const { logger, lines } = recordingLogger();
      // Throw a plain string — JS allows it. errorDetail should normalize.
      const oddCompleter: ChatCompleter = async () => {
        throw 'unexpected-string-throw';
      };
      const scorer = new OpenAIScorer(oddCompleter, logger);
      await scorer.score(sampleCandidate);

      const errLine = lines.find((l) => l.event === 'scorer.network_failed');
      expect(errLine?.data?.name).toBe('NonError');
      expect(errLine?.data?.message).toBe('unexpected-string-throw');
    });
  });
});
