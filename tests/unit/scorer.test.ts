// Unit tests for LLMScorer. We inject a fake ChatCompleter so no real
// provider calls happen and the tests are deterministic.

import { describe, expect, test } from 'bun:test';

import { type ChatCompleter, LLMScorer } from '../../src/clients/scorer.ts';
import type { MealCandidate } from '../../src/models.ts';
import { silentLogger } from '../fixtures/msw.ts';

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

describe('LLMScorer', () => {
  test('parses a valid green response', async () => {
    const scorer = new LLMScorer(
      fakeCompleter(JSON.stringify({ bucket: 'green', reasoning: 'lean protein + veg' })),
      silentLogger,
    );
    const score = await scorer.score(sampleCandidate);
    expect(score.bucket).toBe('green');
    expect(score.reasoning).toBe('lean protein + veg');
  });

  test('parses a valid red response', async () => {
    const scorer = new LLMScorer(
      fakeCompleter(JSON.stringify({ bucket: 'red', reasoning: 'fried + carbs' })),
      silentLogger,
    );
    const score = await scorer.score(sampleCandidate);
    expect(score.bucket).toBe('red');
  });

  test('falls back to red when the response is not JSON', async () => {
    const scorer = new LLMScorer(fakeCompleter('not json at all'), silentLogger);
    const score = await scorer.score(sampleCandidate);
    expect(score.bucket).toBe('red');
    expect(score.reasoning).toMatch(/parse failed: invalid JSON/);
  });

  test('falls back to red when the JSON has the wrong shape', async () => {
    const scorer = new LLMScorer(
      fakeCompleter(JSON.stringify({ verdict: 'green', why: 'nope' })),
      silentLogger,
    );
    const score = await scorer.score(sampleCandidate);
    expect(score.bucket).toBe('red');
    expect(score.reasoning).toMatch(/parse failed/);
  });

  test('falls back to red when bucket is not in the enum', async () => {
    const scorer = new LLMScorer(
      fakeCompleter(JSON.stringify({ bucket: 'blue', reasoning: 'invented color' })),
      silentLogger,
    );
    const score = await scorer.score(sampleCandidate);
    expect(score.bucket).toBe('red');
    expect(score.reasoning).toMatch(/parse failed/);
  });

  test('falls back to red when the chat call throws', async () => {
    const failingCompleter: ChatCompleter = async () => {
      throw new Error('rate limit exceeded');
    };
    const scorer = new LLMScorer(failingCompleter, silentLogger);
    const score = await scorer.score(sampleCandidate);
    expect(score.bucket).toBe('red');
    expect(score.reasoning).toMatch(/scorer error: rate limit exceeded/);
  });

  test('passes only the relevant fields to the LLM (no IDs)', async () => {
    let capturedUser = '';
    const captureCompleter: ChatCompleter = async ({ user }) => {
      capturedUser = user;
      return JSON.stringify({ bucket: 'green', reasoning: 'ok' });
    };
    const scorer = new LLMScorer(captureCompleter, silentLogger);
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
    const scorer = new LLMScorer(captureCompleter, silentLogger);
    await scorer.score(sampleCandidate);

    expect(capturedSystem).toContain('green');
    expect(capturedSystem).toContain('yellow');
    expect(capturedSystem).toContain('red');
  });
});
