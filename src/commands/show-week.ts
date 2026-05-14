// `show-week` subcommand: read-only — login, fetch the week, optionally
// score every editable day's alternatives, print everything to stdout.
// No swaps, no CSV writes, no email.

import { ForkableClient } from '../clients/forkable.ts';
import { type OpenAIScorer, createOpenAIScorer } from '../clients/openai-scorer.ts';
import { loadSettings } from '../config.ts';
import { bucketLabel, dayLabel, formatPrice, truncate } from '../lib/cli-format.ts';
import { thisWeekMonday } from '../lib/dates.ts';
import { type FlatItem, firstPieceWithVenue, flattenItems } from '../lib/forkable-shape.ts';
import { LOG_EVENTS } from '../lib/log-events.ts';
import { redactEmail } from '../lib/redact.ts';
import { createLogger } from '../logger.ts';
import { BUCKET_RANK, type Score, toCandidate } from '../models.ts';
import type { Delivery } from '../schemas/forkable.ts';

export async function showWeek(args: string[]): Promise<number> {
  const noScore = args.includes('--no-score');
  const dateArg = args.find((a) => !a.startsWith('--'));

  // Resend isn't used here at all (show-week never emails). OpenAI is
  // only used when scoring; with --no-score we don't need it either.
  const optional: ('openai' | 'resend')[] = ['resend'];
  if (noScore) optional.push('openai');
  const settings = loadSettings(process.env, { optional });
  const logger = createLogger(settings);
  logger.info(LOG_EVENTS.RUN_ACCOUNT, { account: redactEmail(settings.forkable.email) });

  const client = new ForkableClient(settings.forkable, logger, {
    timeoutMs: settings.forkable.timeoutMs,
  });
  await client.login();
  await client.me();

  const from = dateArg ?? thisWeekMonday();
  logger.info(LOG_EVENTS.SHOW_WEEK_FETCH, { from });
  const days = await client.getWeek(from);
  if (days.length === 0) {
    logger.info(LOG_EVENTS.SHOW_WEEK_NO_DELIVERIES, { from });
    return 0;
  }

  const scorer = noScore ? null : createOpenAIScorer({ apiKey: settings.openaiApiKey }, logger);
  printHeader(from);
  for (const day of days) {
    if (day.isReadOnly) {
      printLockedDay(day);
      continue;
    }
    await printEditableDay(day, client, scorer);
  }
  return 0;
}

function printHeader(from: string): void {
  console.log();
  console.log(`WEEK OF ${from}`);
  console.log('─'.repeat(80));
}

function printLockedDay(day: Delivery): void {
  console.log(`${dayLabel(day)}  LOCKED`);
}

type ScoredItem = FlatItem & { score: Score };

async function printEditableDay(
  day: Delivery,
  client: ForkableClient,
  scorer: OpenAIScorer | null,
): Promise<void> {
  console.log(`${dayLabel(day)}  EDITABLE`);
  printCurrent(day);

  if (!day.club) {
    console.log('  alternatives: (no club id — cannot fetch)');
    return;
  }

  const menus = await client.getAlternatives(day.availableMenuIds, day.club.id);
  const allItems = flattenItems(menus);

  if (scorer === null) {
    printUnscoredAlternatives(allItems);
    return;
  }

  const scored = await scoreAndSort(allItems, scorer);
  printScoredAlternatives(scored);
}

function printCurrent(day: Delivery): void {
  const fpv = firstPieceWithVenue(day);
  if (!fpv) {
    console.log('  current: (none)');
    return;
  }
  const venue = fpv.venueName ?? '(unknown venue)';
  console.log(`  current: ${venue} — ${fpv.piece.name} (${formatPrice(fpv.piece.price)})`);
}

function printUnscoredAlternatives(items: FlatItem[]): void {
  console.log(`  alternatives (${items.length}, unscored — pass an OPENAI_API_KEY to score):`);
  for (const { menuName, item } of items) {
    console.log(
      `             ${truncate(menuName, 22).padEnd(22)}  ${truncate(item.name, 32).padEnd(32)}  ${formatPrice(item.price)}`,
    );
  }
}

async function scoreAndSort(items: FlatItem[], scorer: OpenAIScorer): Promise<ScoredItem[]> {
  const scored: ScoredItem[] = await Promise.all(
    items.map(async (fi) => ({ ...fi, score: await scorer.score(toCandidate(fi.item)) })),
  );
  // Sort green → yellow → red, then by price asc within bucket.
  scored.sort((a, b) => {
    const r = BUCKET_RANK[b.score.bucket] - BUCKET_RANK[a.score.bucket];
    if (r !== 0) return r;
    return (a.item.price ?? 0) - (b.item.price ?? 0);
  });
  return scored;
}

function printScoredAlternatives(scored: ScoredItem[]): void {
  console.log(`  alternatives (${scored.length}, scored):`);
  for (const c of scored) {
    console.log(
      `    ${bucketLabel(c.score.bucket)}  ${truncate(c.menuName, 22).padEnd(22)}  ${truncate(c.item.name, 32).padEnd(32)}  ${formatPrice(c.item.price)}  ${c.score.reasoning}`,
    );
  }
}
