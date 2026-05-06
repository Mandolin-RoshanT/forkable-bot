// Live integration check: exercises ForkableClient against forkable.com,
// running each read-only method and printing what came back. The mutation
// is NOT exercised.
//
//   bun scripts/verify-queries.ts                # this week
//   bun scripts/verify-queries.ts 2026-05-04     # specific Monday

import { ForkableClient } from '../src/clients/forkable.ts';
import { loadSettings } from '../src/config.ts';
import { thisWeekMonday } from '../src/lib/dates.ts';
import { createLogger, redactEmail } from '../src/logger.ts';

async function main(): Promise<void> {
  // OpenAI/Resend keys aren't used by this script; stub them so we don't
  // need them in .env to run a forkable-only check.
  const settings = loadSettings({
    ...process.env,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY || 'unused-in-verify',
    RESEND_API_KEY: process.env.RESEND_API_KEY || 'unused-in-verify',
    NOTIFY_TO_EMAIL: process.env.NOTIFY_TO_EMAIL || 'noreply@example.com',
  });
  const logger = createLogger(settings);
  logger.info(`account: ${redactEmail(settings.forkable.email)}`);

  const client = new ForkableClient(settings.forkable, logger);
  await client.login();
  await client.me();

  // ─── GET_WEEK ─────────────────────────────────────────────────────────────
  const from = process.argv[2] ?? thisWeekMonday();
  logger.info(`\n--- GetWeek(from: ${from}) ---`);
  const days = await client.getWeek(from);
  logger.info(`✓ GetWeek parsed: ${days.length} day(s)`);
  for (const d of days) {
    const piece = d.orders.find((o) => o.pieces.length > 0)?.pieces[0];
    const editable = d.isReadOnly ? 'locked' : 'editable';
    logger.info(
      `    ${d.forDeliveryAt.slice(0, 10)} | ${editable.padEnd(8)} | current: ${piece?.name ?? '(none)'}`,
    );
  }

  // ─── GET_ALTERNATIVES ─────────────────────────────────────────────────────
  const editable = days.find((d) => !d.isReadOnly);
  if (!editable) {
    logger.info('\nno editable days in this week — skipping GetAlternatives check');
    return;
  }
  if (!editable.club) {
    logger.error('editable day has no club.id — cannot run GetAlternatives');
    process.exit(2);
  }

  logger.info(
    `\n--- GetAlternatives(ids: [${editable.availableMenuIds.join(',')}], clubId: ${editable.club.id}) ---`,
  );
  const menus = await client.getAlternatives(editable.availableMenuIds, editable.club.id);
  const totalItems = menus.flatMap((m) => m.sections).flatMap((s) => s.items).length;
  logger.info(`✓ GetAlternatives parsed: ${menus.length} venue(s), ${totalItems} items total`);
  for (const m of menus) {
    const itemCount = m.sections.flatMap((s) => s.items).length;
    logger.info(`    ${(m.displayName ?? m.name).padEnd(28)} | ${itemCount} items`);
  }

  logger.info('\nForkableClient verified live ✓');
}

main().catch((err: Error) => {
  console.error(`[forkable-bot] FAILED: ${err.message}`);
  process.exit(1);
});
