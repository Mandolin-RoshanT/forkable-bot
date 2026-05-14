// pickWeek — golden paths: the locked-day skip, the keep-default flow,
// the swap flow, dry-run gating, and idempotency on re-runs.

import { describe, expect, test } from 'bun:test';

import { pickWeek } from '../../src/core/picker.ts';
import {
  createScorer,
  createSwapRecorder,
  dayWithDefault,
  makeAlternativesFn,
  makeDelivery,
  makeMenu,
} from '../helpers/picker-factories.ts';

const { byName: scoreByName, scoreFn } = createScorer();

describe('pickWeek — golden paths', () => {
  test('skips locked days without calling alternativesFor', async () => {
    let alternativesCalled = 0;
    const result = await pickWeek({
      from: '2026-05-04',
      days: [makeDelivery({ id: 1, isReadOnly: true })],
      alternativesFor: async () => {
        alternativesCalled++;
        return [];
      },
      score: scoreFn,
      swap: async () => {},
      dryRun: false,
    });
    expect(result.days).toHaveLength(1);
    expect(result.days[0]).toEqual({ kind: 'skipped-locked', date: '2026-05-07' });
    expect(alternativesCalled).toBe(0);
  });

  test('keeps default when default is already in the top bucket', async () => {
    scoreByName.Default = 'green';
    scoreByName.Other = 'yellow';
    const day = dayWithDefault(1175988, 100, 5, 'piece-uuid');
    const menus = [
      makeMenu(100, 'Default Venue', [{ id: 5, name: 'Default' }]),
      makeMenu(200, 'Other Venue', [{ id: 6, name: 'Other' }]),
    ];
    const swaps = createSwapRecorder();

    const result = await pickWeek({
      from: '2026-05-04',
      days: [day],
      alternativesFor: makeAlternativesFn(menus),
      score: scoreFn,
      swap: swaps.fn,
      dryRun: false,
    });

    expect(result.days[0]?.kind).toBe('kept-default');
    expect(swaps.calls).toHaveLength(0);
  });

  test('swaps when an alternative outranks the default', async () => {
    scoreByName.Default = 'red';
    scoreByName.Better = 'green';
    const day = dayWithDefault(1175988, 100, 5, 'piece-uuid');
    const menus = [
      makeMenu(100, 'Default Venue', [{ id: 5, name: 'Default' }]),
      makeMenu(200, 'Better Venue', [{ id: 7, name: 'Better' }]),
    ];
    const swaps = createSwapRecorder();

    const result = await pickWeek({
      from: '2026-05-04',
      days: [day],
      alternativesFor: makeAlternativesFn(menus),
      score: scoreFn,
      swap: swaps.fn,
      dryRun: false,
    });

    expect(result.days[0]?.kind).toBe('swapped');
    expect(swaps.calls).toEqual([
      { deliveryId: 1175988, menuId: 200, itemId: 7, oldPieceId: 'piece-uuid' },
    ]);
    if (result.days[0]?.kind === 'swapped') {
      expect(result.days[0].to.name).toBe('Better');
    }
  });

  test('dry-run never invokes swap', async () => {
    scoreByName.Default = 'red';
    scoreByName.Better = 'green';
    const day = dayWithDefault(1175988, 100, 5, 'piece-uuid');
    const menus = [
      makeMenu(100, 'Default Venue', [{ id: 5, name: 'Default' }]),
      makeMenu(200, 'Better Venue', [{ id: 7, name: 'Better' }]),
    ];
    const swaps = createSwapRecorder();

    const result = await pickWeek({
      from: '2026-05-04',
      days: [day],
      alternativesFor: makeAlternativesFn(menus),
      score: scoreFn,
      swap: swaps.fn,
      dryRun: true,
    });

    expect(result.days[0]?.kind).toBe('swapped');
    expect(swaps.calls).toHaveLength(0);
  });

  test('idempotency: a second run on the post-swap state issues no swaps', async () => {
    scoreByName.OldDefault = 'red';
    scoreByName.NewDefault = 'green';
    // After the first swap, the new default IS in the top bucket — second run keeps it.
    const dayPostSwap = dayWithDefault(1175988, 200, 7, 'new-piece-uuid');
    const menus = [
      makeMenu(100, 'Old Venue', [{ id: 5, name: 'OldDefault' }]),
      makeMenu(200, 'New Venue', [{ id: 7, name: 'NewDefault' }]),
    ];
    const swaps = createSwapRecorder();

    const result = await pickWeek({
      from: '2026-05-04',
      days: [dayPostSwap],
      alternativesFor: makeAlternativesFn(menus),
      score: scoreFn,
      swap: swaps.fn,
      dryRun: false,
    });

    expect(result.days[0]?.kind).toBe('kept-default');
    expect(swaps.calls).toHaveLength(0);
  });
});
