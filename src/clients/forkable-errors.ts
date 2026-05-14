// Single typed error for everything ForkableClient throws (per
// .claude/rules/error-handling.md: "A single typed error class per
// domain ... carrying structured context, not just a message").
//
// `kind` lets callers branch on the failure mode; `status` / `body`
// carry HTTP-shaped detail; `context` carries operation metadata
// (operation name, URL, attempt number, etc.); `cause` preserves the
// original error so the chain isn't lost.

export type ForkableErrorKind = 'auth' | 'network' | 'graphql' | 'schema';

export type ForkableErrorContext = {
  operation: string;
  [key: string]: unknown;
};

export type ForkableErrorOptions = {
  kind: ForkableErrorKind;
  message: string;
  status?: number;
  body?: unknown;
  context: ForkableErrorContext;
  cause?: unknown;
};

export class ForkableError extends Error {
  readonly kind: ForkableErrorKind;
  readonly status: number | undefined;
  readonly body: unknown;
  readonly context: ForkableErrorContext;

  constructor(opts: ForkableErrorOptions) {
    super(opts.message, opts.cause !== undefined ? { cause: opts.cause } : undefined);
    this.name = 'ForkableError';
    this.kind = opts.kind;
    this.status = opts.status;
    this.body = opts.body;
    this.context = opts.context;
  }
}
