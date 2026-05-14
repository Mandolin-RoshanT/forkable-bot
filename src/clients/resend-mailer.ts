// ResendMailer: sends failure emails via Resend's REST API. We use raw
// fetch instead of the official SDK to keep deps minimal and the surface
// easy to mock in tests.

import type { Settings } from '../config.ts';
import { LOG_EVENTS } from '../lib/log-events.ts';
import type { Logger } from '../logger.ts';

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

type ResendConfig = {
  apiKey: string;
  from: string;
  to: string;
};

export class ResendMailer {
  // Returns null when RESEND_API_KEY isn't actually set in the environment.
  // The settings-loader stubs that variable so the picker can run without
  // Resend during local development; this factory is the single place
  // that decides "is the mailer real?" so the question doesn't leak into
  // every caller.
  static fromEnv(env: NodeJS.ProcessEnv, settings: Settings, logger: Logger): ResendMailer | null {
    if (!env.RESEND_API_KEY) {
      return null;
    }
    return new ResendMailer(
      {
        apiKey: settings.resend.apiKey,
        from: settings.resend.notifyFrom,
        to: settings.resend.notifyTo,
      },
      logger,
    );
  }

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
    this.logger.info(LOG_EVENTS.MAILER_EMAIL_SENT, { subject });
  }
}
