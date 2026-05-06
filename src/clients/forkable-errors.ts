// Typed errors for ForkableClient. Callers (cli.ts, picker, etc.) catch
// these by class so a network blip is distinguishable from an auth failure
// or a schema-drift bug.

export class ForkableError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ForkableError';
  }
}

export class ForkableAuthError extends ForkableError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ForkableAuthError';
  }
}

export class ForkableNetworkError extends ForkableError {
  constructor(
    message: string,
    public readonly status: number,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'ForkableNetworkError';
  }
}

export class ForkableSchemaError extends ForkableError {
  constructor(message: string, cause: unknown) {
    super(message, { cause });
    this.name = 'ForkableSchemaError';
  }
}
