// Hand-rolled cookie jar — no domain/path matching needed for our single-host
// use case. Encapsulates the `getSetCookie()` cast and the snapshot/diff
// pattern login() needs.

export class CookieJar {
  private readonly cookies = new Map<string, string>();

  // Read every Set-Cookie header on the response and add to the jar.
  add(headers: Headers): void {
    for (const line of headers.getSetCookie()) {
      const firstPair = line.split(';')[0]?.trim();
      if (!firstPair) {
        continue;
      }
      const eq = firstPair.indexOf('=');
      if (eq <= 0) {
        continue;
      }
      this.cookies.set(firstPair.slice(0, eq), firstPair.slice(eq + 1));
    }
  }

  get size(): number {
    return this.cookies.size;
  }

  get(name: string): string | undefined {
    return this.cookies.get(name);
  }

  names(): string[] {
    return [...this.cookies.keys()];
  }

  // Snapshot of cookie names — pair with diff() to detect what a request added.
  snapshot(): Set<string> {
    return new Set(this.cookies.keys());
  }

  diff(snapshot: Set<string>): string[] {
    return [...this.cookies.keys()].filter((n) => !snapshot.has(n));
  }

  // Serialize as `name1=val1; name2=val2; ...` for the `Cookie` request header.
  serialize(): string | undefined {
    if (this.cookies.size === 0) {
      return undefined;
    }
    return [...this.cookies.entries()].map(([n, v]) => `${n}=${v}`).join('; ');
  }
}
