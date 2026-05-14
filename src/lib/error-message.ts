// Safely extract a message string from an unknown thrown value. JavaScript
// allows throwing anything, so `catch (err)` types as `unknown` — these
// helpers avoid the `(err as Error).message` cast at every call site and
// also handle the case where a non-Error was thrown.

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// Pull a structured { name, message, causeMessage? } record out of an
// unknown error so it serializes cleanly into a Logger data payload
// (Error's own fields aren't enumerable; JSON.stringify(err) drops them).
// Walks one level of Error.cause so wrapped errors retain their leaf.
export type ErrorDetail = {
  name: string;
  message: string;
  causeMessage?: string;
};

export function errorDetail(err: unknown): ErrorDetail {
  if (!(err instanceof Error)) {
    return { name: 'NonError', message: String(err) };
  }
  const detail: ErrorDetail = { name: err.name, message: err.message };
  if (err.cause instanceof Error) {
    detail.causeMessage = err.cause.message;
  }
  return detail;
}
