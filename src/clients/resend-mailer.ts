// ResendMailer: sends failure emails via Resend's REST API. We use raw
// fetch instead of the official SDK to keep deps minimal and the surface
// easy to mock in tests.

import { DEFAULT_RESEND_TIMEOUT_MS, type Settings } from '../config.ts';
import { errorMessage } from '../lib/error-message.ts';
import type { FetchFn } from '../lib/fetch.ts';
import { LOG_EVENTS } from '../lib/log-events.ts';
import type { Logger } from '../logger.ts';
import { ResendError } from './resend-errors.ts';

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

type ResendConfig = {
  apiKey: string;
  from: string;
  to: string;
};

export type ResendMailerOptions = {
  fetchFn?: FetchFn;
  timeoutMs?: number;
};

export class ResendMailer {
  private readonly fetchFn: FetchFn;
  private readonly timeoutMs: number;

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
      { timeoutMs: settings.resend.timeoutMs },
    );
  }

  constructor(
    private readonly config: ResendConfig,
    private readonly logger: Logger,
    opts: ResendMailerOptions = {},
  ) {
    this.fetchFn = opts.fetchFn ?? globalThis.fetch.bind(globalThis);
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_RESEND_TIMEOUT_MS;
  }

  // Friday's failure email — short, actionable, no HTML.
  async sendFailure(args: { mode: 'dry-run' | 'pick'; error: unknown }): Promise<void> {
    const errName = args.error instanceof Error ? args.error.name : 'Error';
    const subject = `Forkable bot failed during ${args.mode}: ${errName}`;
    const lines = [
      `The Forkable picker failed during a "${args.mode}" run.`,
      '',
      `Error: ${errName}: ${errorMessage(args.error)}`,
      '',
      'Check the GitHub Actions run for full logs.',
    ];
    await this.send({ subject, text: lines.join('\n') });
  }

  private async send({ subject, text }: { subject: string; text: string }): Promise<void> {
    const ctl = new AbortController();
    const timeoutId = setTimeout(() => ctl.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await this.fetchFn(RESEND_ENDPOINT, {
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
        signal: ctl.signal,
      });
    } catch (err) {
      if (ctl.signal.aborted) {
        throw new ResendError({
          message: `Resend send timed out after ${this.timeoutMs}ms`,
          context: {
            operation: 'sendFailure',
            url: RESEND_ENDPOINT,
            timeoutMs: this.timeoutMs,
            subject,
          },
          cause: err,
        });
      }
      throw new ResendError({
        message: `Resend send failed: ${errorMessage(err)}`,
        context: { operation: 'sendFailure', url: RESEND_ENDPOINT, subject },
        cause: err,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!res.ok) {
      const body = await res.text();
      throw new ResendError({
        message: `Resend send failed: HTTP ${res.status}`,
        status: res.status,
        body: body.slice(0, 500),
        context: { operation: 'sendFailure', url: RESEND_ENDPOINT, subject },
      });
    }
    this.logger.info(LOG_EVENTS.MAILER_EMAIL_SENT, { subject });
  }
}
