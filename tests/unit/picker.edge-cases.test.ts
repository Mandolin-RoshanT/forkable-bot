// pickWeek — edge cases: all-red days, per-day failure isolation,
// yellow-doesn't-displace-green, and days with no current piece.

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

describe('pickWeek — edge cases', () => {
  test('all-red day keeps the (red) default rather than swapping red→red', async () => {
    scoreByName.Default = 'red';
    scoreByName.AlsoRed = 'red';
    const day = dayWithDefault(1, 100, 5, 'piece-uuid');
    const menus = [
      makeMenu(100, 'A', [{ id: 5, name: 'Default' }]),
      makeMenu(200, 'B', [{ id: 6, name: 'AlsoRed' }]),
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

  test('one day failing does not block other days', async () => {
    scoreByName.Default = 'red';
    scoreByName.Better = 'green';
    const failingDay = dayWithDefault(1, 100, 5, 'piece-1', '2026-05-07T12:00:00.000Z');
    const goodDay = dayWithDefault(2, 100, 5, 'piece-2', '2026-05-08T12:00:00.000Z');
    const menus = [
      makeMenu(100, 'A', [{ id: 5, name: 'Default' }]),
      makeMenu(200, 'B', [{ id: 7, name: 'Better' }]),
    ];
    const swaps = createSwapRecorder();

    const result = await pickWeek({
      from: '2026-05-04',
      days: [failingDay, goodDay],
      alternativesFor: (() => {
        let calls = 0;
        return async () => {
          calls++;
          if (calls === 1) {
            throw new Error('transient network failure');
          }
          return menus;
        };
      })(),
      score: scoreFn,
      swap: swaps.fn,
      dryRun: false,
    });

    expect(result.days).toHaveLength(2);
    expect(result.days[0]?.kind).toBe('failed');
    expect(result.days[1]?.kind).toBe('swapped');
    expect(swaps.calls).toHaveLength(1);
  });

  test('yellow alternatives do not displace a green default', async () => {
    // scoreByName has no entries for NeverSeen1/2 → scoreFn falls back to
    // yellow (the default in createScorer). The default is forced green here.
    scoreByName.Default = 'green';
    const day = dayWithDefault(1, 100, 5, 'piece-uuid');
    const menus = [
      makeMenu(100, 'A', [{ id: 5, name: 'Default' }]),
      makeMenu(200, 'B', [{ id: 6, name: 'NeverSeen1' }]),
      makeMenu(300, 'C', [{ id: 7, name: 'NeverSeen2' }]),
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

  test('an order with no piece yields kind=no-default and the picked alternative', async () => {
    scoreByName.OnlyOption = 'green';
    const day = makeDelivery({
      id: 99,
      availableMenuIds: [200],
      orders: [
        // Order exists (Forkable creates one per available venue) but the
        // user has no chosen meal yet — empty pieces[].
        { id: 990, state: 'initial', menu: { id: 200, name: 'only-menu' }, pieces: [] },
      ],
    });
    const menus = [makeMenu(200, 'OnlyVenue', [{ id: 8, name: 'OnlyOption' }])];
    const swaps = createSwapRecorder();

    const result = await pickWeek({
      from: '2026-05-04',
      days: [day],
      alternativesFor: makeAlternativesFn(menus),
      score: scoreFn,
      swap: swaps.fn,
      dryRun: false,
    });

    const dayResult = result.days[0];
    expect(dayResult?.kind).toBe('no-default');
    if (dayResult?.kind === 'no-default') {
      expect(dayResult.picked?.name).toBe('OnlyOption');
    }
    // No oldPieceId → cannot issue a real swap even outside dry-run.
    expect(swaps.calls).toHaveLength(0);
  });
});
