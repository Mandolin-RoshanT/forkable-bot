// Safely extract a message string from an unknown thrown value. JavaScript
// allows throwing anything, so `catch (err)` types as `unknown` — this
// helper avoids the `(err as Error).message` cast at every call site and
// also handles the case where a non-Error was thrown.

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
