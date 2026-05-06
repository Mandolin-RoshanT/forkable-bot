// `show-week` subcommand: read-only — login, fetch the week, optionally
// score every editable day's alternatives, print everything to stdout.
// No swaps, no CSV writes, no email.

import { ForkableClient } from '../clients/forkable.ts';
import { type OpenAIScorer, createOpenAIScorer } from '../clients/openai-scorer.ts';
import { loadSettings } from '../config.ts';
import { bucketLabel, dayLabel, formatPrice, truncate } from '../lib/cli-format.ts';
import { thisWeekMonday } from '../lib/dates.ts';
import { firstPieceWithVenue } from '../lib/delivery.ts';
import { type FlatItem, flattenItems } from '../lib/menus.ts';
import { redactEmail } from '../lib/redact.ts';
import { createLogger } from '../logger.ts';
import { BUCKET_RANK, type Score, toCandidate } from '../models.ts';
import type { Delivery } from '../schemas/forkable.ts';

export async function showWeek(args: string[]): Promise<number> {
  const noScore = args.includes('--no-score');
  const dateArg = args.find((a) => !a.startsWith('--'));

  // Resend keys aren't used here. OpenAI is also unused if --no-score, in
  // which case we stub the key so .env doesn't need to be fully populated
  // for a read-only flow.
  const settings = loadSettings({
    ...process.env,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY || (noScore ? 'unused-by-no-score' : undefined),
    RESEND_API_KEY: process.env.RESEND_API_KEY || 'unused-by-show-week',
    NOTIFY_TO_EMAIL: process.env.NOTIFY_TO_EMAIL || 'noreply@example.com',
  });
  const logger = createLogger(settings);
  logger.info(`account: ${redactEmail(settings.forkable.email)}`);

  const client = new ForkableClient(settings.forkable, logger);
  await client.login();
  await client.me();

  const from = dateArg ?? thisWeekMonday();
  logger.info(`fetching deliveries from ${from}`);
  const days = await client.getWeek(from);
  if (days.length === 0) {
    logger.info('no deliveries returned for that week');
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

async function printEditableDay(
  day: Delivery,
  client: ForkableClient,
  scorer: OpenAIScorer | null,
): Promise<void> {
  console.log(`${dayLabel(day)}  EDITABLE`);

  const fpv = firstPieceWithVenue(day);
  if (fpv) {
    const venue = fpv.venueName ?? '(unknown venue)';
    console.log(`  current: ${venue} — ${fpv.piece.name} (${formatPrice(fpv.piece.price)})`);
  } else {
    console.log('  current: (none)');
  }

  if (!day.club) {
    console.log('  alternatives: (no club id — cannot fetch)');
    return;
  }

  const menus = await client.getAlternatives(day.availableMenuIds, day.club.id);
  const allItems = flattenItems(menus);

  if (scorer === null) {
    console.log(`  alternatives (${allItems.length}, unscored — pass an OPENAI_API_KEY to score):`);
    for (const { menuName, item } of allItems) {
      console.log(
        `             ${truncate(menuName, 22).padEnd(22)}  ${truncate(item.name, 32).padEnd(32)}  ${formatPrice(item.price)}`,
      );
    }
    return;
  }

  type Candidate = FlatItem & { score: Score };
  const scored: Candidate[] = await Promise.all(
    allItems.map(async (fi) => ({ ...fi, score: await scorer.score(toCandidate(fi.item)) })),
  );

  // Sort green → yellow → red, then by price asc within bucket.
  scored.sort((a, b) => {
    const r = BUCKET_RANK[b.score.bucket] - BUCKET_RANK[a.score.bucket];
    if (r !== 0) return r;
    return (a.item.price ?? 0) - (b.item.price ?? 0);
  });

  console.log(`  alternatives (${scored.length}, scored):`);
  for (const c of scored) {
    console.log(
      `    ${bucketLabel(c.score.bucket)}  ${truncate(c.menuName, 22).padEnd(22)}  ${truncate(c.item.name, 32).padEnd(32)}  ${formatPrice(c.item.price)}  ${c.score.reasoning}`,
    );
  }
}
