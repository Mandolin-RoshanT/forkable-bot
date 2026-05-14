// Single typed error for everything ResendMailer throws (per
// .claude/rules/error-handling.md). Mirrors the ForkableError shape so
// the failure-email path produces structured context instead of raw
// Error messages.

export type ResendErrorContext = {
  operation: string;
  [key: string]: unknown;
};

export type ResendErrorOptions = {
  message: string;
  status?: number;
  body?: unknown;
  context: ResendErrorContext;
  cause?: unknown;
};

export class ResendError extends Error {
  readonly status: number | undefined;
  readonly body: unknown;
  readonly context: ResendErrorContext;

  constructor(opts: ResendErrorOptions) {
    super(opts.message, opts.cause !== undefined ? { cause: opts.cause } : undefined);
    this.name = 'ResendError';
    this.status = opts.status;
    this.body = opts.body;
    this.context = opts.context;
  }
}
