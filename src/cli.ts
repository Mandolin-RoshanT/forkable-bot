// Subcommand dispatcher. Wires up ForkableClient + OpenAIScorer per command,
// formats results for stdout, and surfaces the right exit code.

import { ForkableClient } from './clients/forkable.ts';
import { type OpenAIScorer, createOpenAIScorer } from './clients/openai-scorer.ts';
import { loadSettings } from './config.ts';
import { pickWeek } from './core/picker.ts';
import { createLogger, redactEmail } from './logger.ts';
import type { Bucket, DayResult, MealCandidate, Score, WeekResult } from './models.ts';
import type { Delivery, Item } from './schemas/forkable.ts';

export async function run(argv: string[]): Promise<number> {
  const cmd = argv[2];
  switch (cmd) {
    case 'show-week':
      return showWeek(argv.slice(3));
    case 'dry-run':
      return dryRun(argv.slice(3));
    case 'pick':
      console.error("'pick' not yet implemented (lands with the swap mutation)");
      return 1;
    default:
      console.error('usage: bun src/index.ts <show-week | dry-run> [YYYY-MM-DD]');
      return 1;
  }
}

// ─── show-week ─────────────────────────────────────────────────────────────

async function showWeek(args: string[]): Promise<number> {
  const noScore = args.includes('--no-score');
  const dateArg = args.find((a) => !a.startsWith('--'));

  // Resend keys aren't used here. OpenAI is also unused if --no-score.
  // Stub both so .env doesn't need to be fully populated for a read-only flow.
  const settings = loadSettings({
    ...process.env,
    OPENAI_API_KEY:
      process.env.OPENAI_API_KEY || (noScore ? 'unused-by-no-score' : process.env.OPENAI_API_KEY),
    RESEND_API_KEY: process.env.RESEND_API_KEY || 'unused-by-show-week',
    NOTIFY_TO_EMAIL: process.env.NOTIFY_TO_EMAIL || 'noreply@example.com',
    NOTIFY_FROM_EMAIL: process.env.NOTIFY_FROM_EMAIL || 'noreply@example.com',
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

// ─── dry-run ───────────────────────────────────────────────────────────────

async function dryRun(args: string[]): Promise<number> {
  const dateArg = args.find((a) => !a.startsWith('--'));

  // Resend keys aren't used by dry-run; stub them.
  const settings = loadSettings({
    ...process.env,
    RESEND_API_KEY: process.env.RESEND_API_KEY || 'unused-by-dry-run',
    NOTIFY_TO_EMAIL: process.env.NOTIFY_TO_EMAIL || 'noreply@example.com',
    NOTIFY_FROM_EMAIL: process.env.NOTIFY_FROM_EMAIL || 'noreply@example.com',
  });
  const logger = createLogger(settings);
  logger.info(`account: ${redactEmail(settings.forkable.email)}`);

  const client = new ForkableClient(settings.forkable, logger);
  await client.login();
  await client.me();

  const from = dateArg ?? thisWeekMonday();
  logger.info(`dry-run for week of ${from}`);
  const days = await client.getWeek(from);
  if (days.length === 0) {
    logger.info('no deliveries for that week');
    return 0;
  }

  const scorer = createOpenAIScorer({ apiKey: settings.openaiApiKey }, logger);
  const result = await pickWeek({
    from,
    days,
    alternativesFor: (_deliveryId, menuIds, clubId) => client.getAlternatives(menuIds, clubId),
    score: (cand) => scorer.score(cand),
    swap: async () => {
      // dry-run: no real swap.
    },
    dryRun: true,
  });

  printWeekResult(result);
  return 0;
}

function printWeekResult(result: WeekResult): void {
  console.log();
  console.log(`DRY-RUN — WEEK OF ${result.from}`);
  console.log('─'.repeat(80));
  for (const day of result.days) {
    printDayResult(day);
  }
  console.log();
  printSummary(result);
}

function printDayResult(day: DayResult): void {
  switch (day.kind) {
    case 'skipped-locked':
      console.log(`${day.date}  LOCKED`);
      break;
    case 'kept-default':
      console.log(
        `${day.date}  KEEP DEFAULT  [${day.bucket}]  ${day.current.venue} — ${day.current.name} (${formatPrice(day.current.price)})`,
      );
      console.log(`             ↳ ${day.reason}`);
      break;
    case 'swapped':
      console.log(`${day.date}  SWAP  [${day.bucket}]`);
      console.log(
        `             from: ${day.from.venue} — ${day.from.name} (${formatPrice(day.from.price)})`,
      );
      console.log(
        `             to:   ${day.to.venue} — ${day.to.name} (${formatPrice(day.to.price)})`,
      );
      console.log(`             ↳ ${day.reasoning}`);
      break;
    case 'no-default':
      console.log(`${day.date}  NO DEFAULT`);
      if (day.picked) {
        console.log(
          `             picked: ${day.picked.venue} — ${day.picked.name} (${formatPrice(day.picked.price)})`,
        );
      }
      console.log(`             ↳ ${day.reason}`);
      break;
    case 'failed':
      console.log(`${day.date}  FAILED — ${day.reason}`);
      break;
  }
}

function printSummary(result: WeekResult): void {
  const counts = { swapped: 0, kept: 0, locked: 0, failed: 0, noDefault: 0 };
  for (const day of result.days) {
    if (day.kind === 'swapped') counts.swapped++;
    else if (day.kind === 'kept-default') counts.kept++;
    else if (day.kind === 'skipped-locked') counts.locked++;
    else if (day.kind === 'failed') counts.failed++;
    else if (day.kind === 'no-default') counts.noDefault++;
  }
  console.log(
    `summary: ${counts.swapped} swap(s), ${counts.kept} kept, ${counts.locked} locked, ${counts.noDefault} no-default, ${counts.failed} failed`,
  );
}

// ─── printing helpers ──────────────────────────────────────────────────────

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

  const current = currentPiece(day);
  if (current) {
    const venue = currentVenueName(day) ?? '(unknown venue)';
    console.log(`  current: ${venue} — ${current.name} (${formatPrice(current.price)})`);
  } else {
    console.log('  current: (none)');
  }

  if (!day.club) {
    console.log('  alternatives: (no club id — cannot fetch)');
    return;
  }

  const menus = await client.getAlternatives(day.availableMenuIds, day.club.id);
  const allItems: { menuName: string; item: Item }[] = [];
  for (const menu of menus) {
    const menuName = menu.displayName ?? menu.name;
    for (const section of menu.sections) {
      for (const item of section.items) {
        allItems.push({ menuName, item });
      }
    }
  }

  if (scorer === null) {
    console.log(`  alternatives (${allItems.length}, unscored — pass an OPENAI_API_KEY to score):`);
    for (const { menuName, item } of allItems) {
      console.log(
        `             ${truncate(menuName, 22).padEnd(22)}  ${truncate(item.name, 32).padEnd(32)}  ${formatPrice(item.price)}`,
      );
    }
    return;
  }

  type Candidate = { menuName: string; item: Item; score: Score };
  const scored: Candidate[] = await Promise.all(
    allItems.map(async ({ menuName, item }) => ({
      menuName,
      item,
      score: await scorer.score(toCandidate(item)),
    })),
  );

  // Sort green → yellow → red, then by price asc within bucket.
  scored.sort((a, b) => {
    const r = bucketRank(a.score.bucket) - bucketRank(b.score.bucket);
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

// ─── small pure helpers ────────────────────────────────────────────────────

function thisWeekMonday(): string {
  const today = new Date();
  const dayOfWeek = today.getDay();
  const daysFromMonday = (dayOfWeek + 6) % 7;
  const monday = new Date(today);
  monday.setDate(today.getDate() - daysFromMonday);
  return monday.toISOString().slice(0, 10);
}

function dayLabel(day: Delivery): string {
  const d = new Date(day.forDeliveryAt);
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()];
  return `${dow} ${day.forDeliveryAt.slice(0, 10)}`;
}

function currentPiece(day: Delivery): Delivery['orders'][number]['pieces'][number] | undefined {
  for (const order of day.orders) {
    const piece = order.pieces[0];
    if (piece) return piece;
  }
  return undefined;
}

function currentVenueName(day: Delivery): string | undefined {
  for (const order of day.orders) {
    if (order.pieces.length > 0) {
      return order.menu?.name;
    }
  }
  return undefined;
}

function toCandidate(item: Item): MealCandidate {
  return {
    name: item.name,
    description: item.description,
    price: item.price,
    ingredientTags: item.ingredientTags,
    dietLevel: item.dietLevel,
  };
}

function bucketRank(b: Bucket): number {
  switch (b) {
    case 'green':
      return 0;
    case 'yellow':
      return 1;
    case 'red':
      return 2;
  }
}

function bucketLabel(b: Bucket): string {
  switch (b) {
    case 'green':
      return '[GREEN] ';
    case 'yellow':
      return '[YELLOW]';
    case 'red':
      return '[RED]   ';
  }
}

function formatPrice(n: number | null): string {
  if (n === null) return '   --   ';
  return `$${n.toFixed(2).padStart(6)}`;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}
