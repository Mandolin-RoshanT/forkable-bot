// Injectable fetch function signature. Constructors that make HTTP calls
// accept an optional `fetchFn` so tests can stub a Response without
// patching the global. Defaults to `globalThis.fetch` in production
// (per .claude/rules/deliverables.md: "Tests inject a stub; nobody mocks
// globals").

export type FetchFn = (
  url: string,
  init?: RequestInit & { signal?: AbortSignal },
) => Promise<Response>;
