// ForkableClient: stateful wrapper around forkable.com's GraphQL API.
//
// Owns the cookie jar internally; callers get high-level methods that return
// already-validated domain objects. Each network response is parsed by its
// matching Zod schema — schema drift surfaces as a typed error here, not as
// a silent `undefined` deeper in the picker.

import type { Settings } from '../config.ts';
import type { Logger } from '../logger.ts';
import { redactCookie } from '../logger.ts';
import {
  CREATE_SESSION_MUTATION,
  GET_ALTERNATIVES_QUERY,
  GET_WEEK_QUERY,
  type GetAlternativesVariables,
  type GetWeekVariables,
  ME_QUERY,
} from '../queries/forkable.ts';
import {
  CreateSessionResponseSchema,
  type Delivery,
  type ForkableUser,
  GetAlternativesResponseSchema,
  GetWeekResponseSchema,
  MeResponseSchema,
  type Menu,
} from '../schemas/forkable.ts';

const FORKABLE_GRAPHQL = 'https://forkable.com/api/v2/graphql';

const BROWSER_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
  Accept: 'application/json',
  Origin: 'https://forkable.com',
  Referer: 'https://forkable.com/mc/',
  'Forkable-Referrer': 'mc',
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
};

// ─── Typed errors ──────────────────────────────────────────────────────────

export class ForkableError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ForkableError';
  }
}

export class ForkableAuthError extends ForkableError {
  constructor(message: string) {
    super(message);
    this.name = 'ForkableAuthError';
  }
}

export class ForkableNetworkError extends ForkableError {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'ForkableNetworkError';
  }
}

export class ForkableSchemaError extends ForkableError {
  constructor(message: string, cause: unknown) {
    super(message, { cause });
    this.name = 'ForkableSchemaError';
  }
}

// ─── Client ────────────────────────────────────────────────────────────────

type CookieJar = Map<string, string>;

type GraphQLBody = {
  operationName?: string;
  query: string;
  variables?: Record<string, unknown>;
};

type GraphQLResponse<T = unknown> = {
  data?: T;
  errors?: Array<{ message: string; path?: string[] }>;
};

export class ForkableClient {
  private readonly jar: CookieJar = new Map();
  private loggedInUser: ForkableUser | null = null;

  constructor(
    private readonly settings: Settings,
    private readonly logger: Logger,
  ) {}

  // Full login flow: warmup → createSession → confirm session cookie present.
  async login(): Promise<ForkableUser> {
    await this.warmup();

    const raw = await this.post(
      {
        operationName: 'CreateSession',
        query: CREATE_SESSION_MUTATION,
        variables: {
          input: {
            email: this.settings.forkable.email,
            password: this.settings.forkable.password,
          },
        },
      },
      'CreateSession',
    );

    const parsed = CreateSessionResponseSchema.parse(raw);
    const session = parsed.createSession;

    if (!session.user) {
      throw new ForkableAuthError(
        `createSession returned no user. errorAttributes=${JSON.stringify(
          session.errorAttributes,
        )} errorDetails=${JSON.stringify(session.errorDetails)}`,
      );
    }
    if (session.user.mfaEnabled) {
      throw new ForkableAuthError('MFA is enabled — bot cannot proceed (PRD §7.1).');
    }

    const sessionCookieName = this.findSessionCookieName();
    if (!sessionCookieName) {
      throw new ForkableAuthError('createSession returned no Set-Cookie — auth flow broken');
    }

    const cookieValue = this.jar.get(sessionCookieName) ?? '';
    this.logger.info(`createSession → ok (user ${session.user.id})`);
    this.logger.info(`cookie attached: ${sessionCookieName}=${redactCookie(cookieValue)}`);

    this.loggedInUser = session.user;
    return session.user;
  }

  async me(): Promise<ForkableUser> {
    const raw = await this.post({ query: ME_QUERY }, 'Me');
    const parsed = MeResponseSchema.parse(raw);
    if (!parsed.me) {
      throw new ForkableAuthError('me returned null — session cookie not accepted');
    }
    this.logger.info(`me → ok (user ${parsed.me.id})`);
    return parsed.me;
  }

  // Returns the user's deliveries on or after `from` (YYYY-MM-DD). Pass the
  // week's Monday to get the full Mon–Fri window.
  async getWeek(from: string): Promise<Delivery[]> {
    const variables: GetWeekVariables = { from };
    const raw = await this.post(
      { operationName: 'GetWeek', query: GET_WEEK_QUERY, variables },
      'GetWeek',
    );
    const parsed = GetWeekResponseSchema.parse(raw);
    return parsed.myDeliveries;
  }

  async getAlternatives(menuIds: number[], clubId: number): Promise<Menu[]> {
    const variables: GetAlternativesVariables = { ids: menuIds, clubId };
    const raw = await this.post(
      { operationName: 'GetAlternatives', query: GET_ALTERNATIVES_QUERY, variables },
      'GetAlternatives',
    );
    const parsed = GetAlternativesResponseSchema.parse(raw);
    return parsed.menus;
  }

  // ─── private ─────────────────────────────────────────────────────────────

  // Anonymous POST → expected 401, seeds AWS ALB sticky-session cookies.
  private async warmup(): Promise<void> {
    const before = this.jar.size;
    const res = await fetch(FORKABLE_GRAPHQL, {
      method: 'POST',
      headers: BROWSER_HEADERS,
      body: JSON.stringify({ query: '{__typename}' }),
    });
    await res.text();
    this.applySetCookies(res.headers);
    const captured = this.jar.size - before;
    this.logger.info(
      `warmup → ${res.status} (${captured} sticky cookie${captured === 1 ? '' : 's'})`,
    );
  }

  private async post(body: GraphQLBody, opLabel: string): Promise<unknown> {
    const headers: Record<string, string> = { ...BROWSER_HEADERS };
    const cookie = this.cookieHeader();
    if (cookie) {
      headers.Cookie = cookie;
    }

    const cookieNames = [...this.jar.keys()].join(', ') || 'none';
    this.logger.debug(`  → POST ${opLabel} (cookies: ${cookieNames})`);

    const res = await fetch(FORKABLE_GRAPHQL, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    this.applySetCookies(res.headers);

    const text = await res.text();
    this.logger.debug(`  ← ${res.status} ${res.statusText} (${text.length}B)`);

    if (!res.ok) {
      throw new ForkableNetworkError(
        `${opLabel}: HTTP ${res.status} ${res.statusText}: ${text.slice(0, 500)}`,
        res.status,
      );
    }

    let parsed: GraphQLResponse;
    try {
      parsed = JSON.parse(text) as GraphQLResponse;
    } catch (err) {
      throw new ForkableSchemaError(`${opLabel}: response was not valid JSON`, err);
    }

    if (parsed.errors && parsed.errors.length > 0) {
      throw new ForkableError(`${opLabel}: GraphQL errors: ${JSON.stringify(parsed.errors)}`);
    }

    return parsed.data;
  }

  private applySetCookies(headers: Headers): void {
    const headersAny = headers as unknown as { getSetCookie?: () => string[] };
    const lines = headersAny.getSetCookie?.() ?? [];
    for (const line of lines) {
      const firstPair = line.split(';')[0]?.trim();
      if (!firstPair) continue;
      const eq = firstPair.indexOf('=');
      if (eq <= 0) continue;
      this.jar.set(firstPair.slice(0, eq), firstPair.slice(eq + 1));
    }
  }

  private cookieHeader(): string | undefined {
    if (this.jar.size === 0) return undefined;
    return [...this.jar.entries()].map(([n, v]) => `${n}=${v}`).join('; ');
  }

  private findSessionCookieName(): string | undefined {
    const names = [...this.jar.keys()];
    for (const n of names) {
      if (n.toLowerCase().includes('session')) return n;
    }
    return names[0];
  }
}
