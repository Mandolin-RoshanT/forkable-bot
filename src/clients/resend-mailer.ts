// ResendMailer: sends failure / summary emails via Resend's REST API.
// We use raw fetch instead of the official SDK to keep deps minimal and the
// surface easy to mock in tests.

import type { Logger } from '../logger.ts';
import type { WeekResult } from '../models.ts';

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

export type ResendConfig = {
  apiKey: string;
  from: string;
  to: string;
};

export class ResendMailer {
  constructor(
    private readonly config: ResendConfig,
    private readonly logger: Logger,
  ) {}

  // Friday's failure email — short, actionable, no HTML.
  async sendFailure(args: { mode: 'dry-run' | 'pick'; error: Error }): Promise<void> {
    const subject = `Forkable bot failed during ${args.mode}: ${args.error.name}`;
    const lines = [
      `The Forkable picker failed during a "${args.mode}" run.`,
      '',
      `Error: ${args.error.name}: ${args.error.message}`,
      '',
      'Check the GitHub Actions run for full logs.',
    ];
    await this.send({ subject, text: lines.join('\n') });
  }

  async sendSummary(result: WeekResult): Promise<void> {
    const subject = `Forkable picks for week of ${result.from}`;
    const lines: string[] = [`Week of ${result.from}:`, ''];
    for (const day of result.days) {
      lines.push(formatDayLine(day));
    }
    await this.send({ subject, text: lines.join('\n') });
  }

  private async send({ subject, text }: { subject: string; text: string }): Promise<void> {
    const res = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: this.config.from,
        to: this.config.to,
        subject,
        text,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Resend send failed: HTTP ${res.status}: ${body.slice(0, 500)}`);
    }
    this.logger.info(`email sent: "${subject}"`);
  }
}

// One-line summary per day for the summary email.
function formatDayLine(day: WeekResult['days'][number]): string {
  switch (day.kind) {
    case 'skipped-locked':
      return `  ${day.date}  LOCKED`;
    case 'kept-default':
      return `  ${day.date}  KEEP    ${day.current.venue} — ${day.current.name}`;
    case 'swapped':
      return `  ${day.date}  SWAP    ${day.from.venue} → ${day.to.venue} (${day.to.name})`;
    case 'no-default':
      return `  ${day.date}  NO-DEF  picked: ${day.picked?.name ?? '(none)'}`;
    case 'failed':
      return `  ${day.date}  FAILED  ${day.reason}`;
  }
}
