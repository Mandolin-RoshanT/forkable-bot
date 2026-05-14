// `pick` and `dry-run` subcommands: login, score the week, swap (or
// don't, in dry-run), write the per-week CSV, print the result. Top-
// level catch fans out to the failure-email mailer.

import { ForkableClient } from '../clients/forkable.ts';
import { createOpenAIScorer } from '../clients/openai-scorer.ts';
import { ResendMailer } from '../clients/resend-mailer.ts';
import { CsvRunLogWriter } from '../clients/run-log-writer.ts';
import { loadSettings } from '../config.ts';
import { pickWeek } from '../core/picker.ts';
import { buildRows } from '../core/run-log.ts';
import { formatPrice } from '../lib/cli-format.ts';
import { thisWeekMonday } from '../lib/dates.ts';
import { errorMessage } from '../lib/error-message.ts';
import { assertNever } from '../lib/exhaustive.ts';
import { LOG_EVENTS } from '../lib/log-events.ts';
import { redactEmail } from '../lib/redact.ts';
import { type Logger, createLogger } from '../logger.ts';
import type { DayResult, WeekResult } from '../models.ts';

function runLogPath(from: string): string {
  return `runs/${from}.csv`;
}

export async function runPicker(args: string[], opts: { dryRun: boolean }): Promise<number> {
  const dateArg = args.find((a) => !a.startsWith('--'));
  const skipLog = args.includes('--no-log');

  // Stub anything missing so .env doesn't need to be fully populated to
  // exercise the picker locally. Production cron has all secrets.
  const settings = loadSettings({
    ...process.env,
    RESEND_API_KEY: process.env.RESEND_API_KEY || 'unconfigured',
    NOTIFY_TO_EMAIL: process.env.NOTIFY_TO_EMAIL || 'noreply@example.com',
  });
  const logger = createLogger(settings);
  logger.info(LOG_EVENTS.RUN_ACCOUNT, { account: redactEmail(settings.forkable.email) });
  logger.info(LOG_EVENTS.RUN_MODE, { mode: opts.dryRun ? 'dry-run' : 'pick' });

  const mailer = ResendMailer.fromEnv(process.env, settings, logger);

  try {
    const client = new ForkableClient(settings.forkable, logger, {
      timeoutMs: settings.forkable.timeoutMs,
    });
    await client.login();
    await client.me();

    const from = dateArg ?? thisWeekMonday();
    logger.info(LOG_EVENTS.RUN_TARGET_WEEK, { from });
    const days = await client.getWeek(from);
    if (days.length === 0) {
      logger.info(LOG_EVENTS.RUN_NO_DELIVERIES, { from });
      return 0;
    }

    const scorer = createOpenAIScorer({ apiKey: settings.openaiApiKey }, logger);
    const result = await pickWeek({
      from,
      days,
      alternativesFor: (_deliveryId, menuIds, clubId) => client.getAlternatives(menuIds, clubId),
      score: (cand) => scorer.score(cand),
      swap: opts.dryRun ? async () => {} : (input) => client.swapMeal(input),
      dryRun: opts.dryRun,
    });

    if (!skipLog) {
      const writer = new CsvRunLogWriter(runLogPath(from), logger);
      const rows = buildRows(new Date().toISOString(), opts.dryRun ? 'dry-run' : 'pick', result);
      await writer.write(rows);
    }

    printWeekResult(result, opts.dryRun);
    return 0;
  } catch (err) {
    await notifyFailure(err, opts.dryRun ? 'dry-run' : 'pick', mailer, logger);
    throw err;
  }
}

// Best-effort failure notification — sends an email if Resend is configured,
// logs and swallows on send error so the original cause still propagates.
async function notifyFailure(
  err: unknown,
  mode: 'dry-run' | 'pick',
  mailer: ResendMailer | null,
  logger: Logger,
): Promise<void> {
  if (!mailer) {
    logger.warn(LOG_EVENTS.RUN_NO_MAILER);
    return;
  }
  try {
    await mailer.sendFailure({ mode, error: err });
  } catch (mailErr) {
    logger.error(LOG_EVENTS.RUN_MAIL_SEND_FAILED, { error: errorMessage(mailErr) });
  }
}

function printWeekResult(result: WeekResult, dryRun: boolean): void {
  console.log();
  console.log(`${dryRun ? 'DRY-RUN' : 'LIVE'} — WEEK OF ${result.from}`);
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
    default:
      assertNever(day);
  }
}

function printSummary(result: WeekResult): void {
  const counts = { swapped: 0, kept: 0, locked: 0, failed: 0, noDefault: 0 };
  for (const day of result.days) {
    switch (day.kind) {
      case 'swapped':
        counts.swapped++;
        break;
      case 'kept-default':
        counts.kept++;
        break;
      case 'skipped-locked':
        counts.locked++;
        break;
      case 'failed':
        counts.failed++;
        break;
      case 'no-default':
        counts.noDefault++;
        break;
      default:
        assertNever(day);
    }
  }
  console.log(
    `summary: ${counts.swapped} swap(s), ${counts.kept} kept, ${counts.locked} locked, ${counts.noDefault} no-default, ${counts.failed} failed`,
  );
}
