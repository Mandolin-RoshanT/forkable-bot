// Live integration check for src/queries/ + src/schemas/.
// Logs in, runs each read-only query against forkable.com, and parses the
// response with the matching Zod schema. The mutation is NOT exercised.
//
//   bun scripts/verify-queries.ts

import {
  GET_ALTERNATIVES_QUERY,
  GET_WEEK_QUERY,
  type GetAlternativesVariables,
  type GetWeekVariables,
} from '../src/queries/forkable.ts';
import { GetAlternativesResponseSchema, GetWeekResponseSchema } from '../src/schemas/forkable.ts';
import { login } from './lib/auth.ts';
import { FORKABLE_GRAPHQL } from './lib/constants.ts';
import { graphql } from './lib/graphql.ts';
import { log, logError, redactEmail } from './lib/logging.ts';
import type { CookieJar } from './lib/types.ts';

// This week's Monday in ISO 8601 (YYYY-MM-DD). We default to *this* week's
// Monday so the live verify exercises real data; the production picker uses
// next Monday at cron time. CLI arg overrides for ad-hoc checking.
function thisWeekMonday(): string {
  const today = new Date();
  const dayOfWeek = today.getDay();
  const daysFromMonday = (dayOfWeek + 6) % 7;
  const monday = new Date(today);
  monday.setDate(today.getDate() - daysFromMonday);
  return monday.toISOString().slice(0, 10);
}

async function main(): Promise<void> {
  const email = process.env.FORKABLE_EMAIL;
  const password = process.env.FORKABLE_PASSWORD;
  if (!email || !password) {
    logError('FORKABLE_EMAIL and FORKABLE_PASSWORD must be set in .env');
    process.exit(1);
  }
  log(`account: ${redactEmail(email)}`);

  const jar: CookieJar = new Map();
  await login(email, password, jar);

  // ─── GET_WEEK ─────────────────────────────────────────────────────────────
  const from = process.argv[2] ?? thisWeekMonday();
  log(`\n--- GetWeek(from: ${from}) ---`);
  const weekRaw = await graphql(
    FORKABLE_GRAPHQL,
    {
      operationName: 'GetWeek',
      query: GET_WEEK_QUERY,
      variables: { from } satisfies GetWeekVariables,
    },
    jar,
  );
  if (weekRaw.errors && weekRaw.errors.length > 0) {
    logError(`GetWeek errors: ${JSON.stringify(weekRaw.errors)}`);
    process.exit(2);
  }
  const week = GetWeekResponseSchema.parse(weekRaw.data);
  log(`✓ GetWeek parsed: ${week.myDeliveries.length} day(s)`);
  for (const d of week.myDeliveries) {
    const piece = d.orders.find((o) => o.pieces.length > 0)?.pieces[0];
    const editable = d.isReadOnly ? 'locked' : 'editable';
    log(
      `    ${d.forDeliveryAt.slice(0, 10)} | ${editable.padEnd(8)} | current: ${piece?.name ?? '(none)'}`,
    );
  }

  // ─── GET_ALTERNATIVES ─────────────────────────────────────────────────────
  // Pick the first editable day to query alternatives for.
  const editableDay = week.myDeliveries.find((d) => !d.isReadOnly);
  if (!editableDay) {
    log('\nno editable days in this week — skipping GetAlternatives check');
    return;
  }
  if (!editableDay.club) {
    logError('editable day has no club.id — cannot run GetAlternatives');
    process.exit(2);
  }

  log(
    `\n--- GetAlternatives(ids: [${editableDay.availableMenuIds.join(',')}], clubId: ${editableDay.club.id}) ---`,
  );
  const altRaw = await graphql(
    FORKABLE_GRAPHQL,
    {
      operationName: 'GetAlternatives',
      query: GET_ALTERNATIVES_QUERY,
      variables: {
        ids: editableDay.availableMenuIds,
        clubId: editableDay.club.id,
      } satisfies GetAlternativesVariables,
    },
    jar,
  );
  if (altRaw.errors && altRaw.errors.length > 0) {
    logError(`GetAlternatives errors: ${JSON.stringify(altRaw.errors)}`);
    process.exit(2);
  }
  const alts = GetAlternativesResponseSchema.parse(altRaw.data);
  const totalItems = alts.menus.flatMap((m) => m.sections).flatMap((s) => s.items).length;
  log(`✓ GetAlternatives parsed: ${alts.menus.length} venue(s), ${totalItems} items total`);
  for (const m of alts.menus) {
    const itemCount = m.sections.flatMap((s) => s.items).length;
    log(`    ${(m.displayName ?? m.name).padEnd(28)} | ${itemCount} items`);
  }

  log('\nall queries + schemas verified live ✓');
}

main().catch((err: Error) => {
  logError(`FAILED: ${err.message}`);
  process.exit(1);
});
