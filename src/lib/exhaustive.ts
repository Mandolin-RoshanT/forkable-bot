// Exhaustiveness helper for discriminated-union switches.
// Place in a `default:` arm so adding a new kind to the union forces a
// compile error at every consumer instead of silently falling through.
export function assertNever(value: never): never {
  throw new Error(`unreachable: unhandled discriminant ${JSON.stringify(value)}`);
}
