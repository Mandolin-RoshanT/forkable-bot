// ForkableClient: stateful wrapper around forkable.com's GraphQL API.
//
// Owns the cookie jar internally; callers get high-level methods that return
// already-validated domain objects. Each network response is parsed by its
// matching Zod schema — schema drift surfaces as a typed error here, not as
// a silent `undefined` deeper in the picker.

import { BROWSER_HEADERS, FORKABLE_GRAPHQL } from '../lib/constants.ts';
import { CookieJar } from '../lib/cookie-jar.ts';
import type { Logger } from '../logger.ts';
import { redactCookie } from '../logger.ts';
import {
  CREATE_SESSION_MUTATION,
  GET_ALTERNATIVES_QUERY,
  GET_WEEK_QUERY,
  type GetAlternativesVariables,
  type GetWeekVariables,
  ME_QUERY,
  REPLACE_PIECE_MUTATION,
  type ReplacePieceVariables,
} from '../queries/forkable.ts';
import {
  CreateSessionResponseSchema,
  type Delivery,
  type ForkableUser,
  GetAlternativesResponseSchema,
  GetWeekResponseSchema,
  MeResponseSchema,
  type Menu,
  ReplacePieceResponseSchema,
} from '../schemas/forkable.ts';

// ─── Typed errors ──────────────────────────────────────────────────────────

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

// ─── Client ────────────────────────────────────────────────────────────────

export type ForkableCreds = { email: string; password: string };

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
  private readonly jar = new CookieJar();
  private loggedInUser: ForkableUser | null = null;

  constructor(
    private readonly creds: ForkableCreds,
    private readonly logger: Logger,
  ) {}

  // Full login flow: warmup → createSession → confirm session cookie present.
  async login(): Promise<ForkableUser> {
    await this.warmup();

    // Snapshot before createSession so we can detect what cookies it added —
    // the warmup ALB cookies are already in the jar but they aren't auth.
    const beforeLogin = this.jar.snapshot();

    const raw = await this.post(
      {
        operationName: 'CreateSession',
        query: CREATE_SESSION_MUTATION,
        variables: {
          input: { email: this.creds.email, password: this.creds.password },
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

    const newCookies = this.jar.diff(beforeLogin);
    const sessionCookieName =
      newCookies.find((n) => n.toLowerCase().includes('session')) ?? newCookies[0];
    if (!sessionCookieName) {
      throw new ForkableAuthError('createSession set no new cookies — auth flow broken');
    }
    const cookieValue = this.jar.get(sessionCookieName) ?? '';

    this.logger.info(`createSession → ok (user ${session.user.id})`);
    this.logger.info(`cookie attached: ${sessionCookieName}=${redactCookie(cookieValue)}`);

    this.loggedInUser = session.user;
    return session.user;
  }

  async me(): Promise<ForkableUser> {
    this.requireLogin('me');
    const raw = await this.post({ operationName: 'Me', query: ME_QUERY }, 'Me');
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
    this.requireLogin('getWeek');
    const variables: GetWeekVariables = { from };
    const raw = await this.post(
      { operationName: 'GetWeek', query: GET_WEEK_QUERY, variables },
      'GetWeek',
    );
    const parsed = GetWeekResponseSchema.parse(raw);
    return parsed.myDeliveries;
  }

  async getAlternatives(menuIds: number[], clubId: number): Promise<Menu[]> {
    this.requireLogin('getAlternatives');
    const variables: GetAlternativesVariables = { ids: menuIds, clubId };
    const raw = await this.post(
      { operationName: 'GetAlternatives', query: GET_ALTERNATIVES_QUERY, variables },
      'GetAlternatives',
    );
    const parsed = GetAlternativesResponseSchema.parse(raw);
    return parsed.menus;
  }

  // Swap the user's chosen piece for a different (menu, item) on the same day.
  // Per locked v1 decision: selectionsHash={} (server fills modifier defaults).
  // Throws ForkableNetworkError / ForkableError / ForkableSchemaError on
  // failure; caller catches per-day so a single bad swap can't kill the run.
  async swapMeal(args: {
    deliveryId: number;
    oldPieceId: string;
    menuId: number;
    itemId: number;
  }): Promise<void> {
    this.requireLogin('swapMeal');
    const variables: ReplacePieceVariables = {
      input: {
        deliveryId: args.deliveryId,
        oldPieceId: args.oldPieceId,
        menuId: args.menuId,
        itemId: args.itemId,
        instructions: '',
        selectionsHash: {},
        fromTopRated: true,
        topRatedType: 'venue_rating',
        myMeals: true,
      },
    };
    const raw = await this.post(
      { operationName: 'ReplacePiece', query: REPLACE_PIECE_MUTATION, variables },
      'ReplacePiece',
    );
    // Validate the shape; we don't need the value.
    ReplacePieceResponseSchema.parse(raw);
    this.logger.info(
      `replacePiece → ok (delivery ${args.deliveryId}, menu ${args.menuId}, item ${args.itemId})`,
    );
  }

  // ─── private ─────────────────────────────────────────────────────────────

  private requireLogin(method: string): void {
    if (!this.loggedInUser) {
      throw new ForkableAuthError(`must login() before calling ${method}()`);
    }
  }

  // Anonymous POST → expected 401, seeds AWS ALB sticky-session cookies.
  private async warmup(): Promise<void> {
    const before = this.jar.size;
    const res = await fetch(FORKABLE_GRAPHQL, {
      method: 'POST',
      headers: BROWSER_HEADERS,
      body: JSON.stringify({ query: '{__typename}' }),
    });
    await res.text();
    this.jar.add(res.headers);
    const captured = this.jar.size - before;
    this.logger.info(
      `warmup → ${res.status} (${captured} sticky cookie${captured === 1 ? '' : 's'})`,
    );
  }

  // Public escape hatch for the spike scripts (capture-ops, probe, introspect)
  // and any future ad-hoc tooling. Returns the full GraphQL response, errors
  // and all — perfect for replay / probing where you want to inspect what the
  // server said. Network errors (non-2xx) and malformed JSON still throw.
  async rawQuery(body: GraphQLBody, opLabel = 'rawQuery'): Promise<GraphQLResponse> {
    this.requireLogin(opLabel);
    return this.postRaw(body, opLabel);
  }

  // Network primitive — returns the parsed response, throwing on non-2xx
  // and malformed JSON but NOT on `response.errors`.
  private async postRaw(body: GraphQLBody, opLabel: string): Promise<GraphQLResponse> {
    const headers: Record<string, string> = { ...BROWSER_HEADERS };
    const cookie = this.jar.serialize();
    if (cookie) {
      headers.Cookie = cookie;
    }

    const cookieNames = this.jar.names().join(', ') || 'none';
    this.logger.debug(`  → POST ${opLabel} (cookies: ${cookieNames})`);

    const res = await fetch(FORKABLE_GRAPHQL, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    this.jar.add(res.headers);

    const text = await res.text();
    this.logger.debug(`  ← ${res.status} ${res.statusText} (${text.length}B)`);

    if (!res.ok) {
      throw new ForkableNetworkError(
        `${opLabel}: HTTP ${res.status} ${res.statusText}: ${text.slice(0, 500)}`,
        res.status,
      );
    }

    try {
      return JSON.parse(text) as GraphQLResponse;
    } catch (err) {
      throw new ForkableSchemaError(`${opLabel}: response was not valid JSON`, err);
    }
  }

  // Adds the throw-on-response.errors check on top of postRaw — what the
  // typed methods (login, me, getWeek, getAlternatives) want.
  private async post(body: GraphQLBody, opLabel: string): Promise<unknown> {
    const res = await this.postRaw(body, opLabel);
    if (res.errors && res.errors.length > 0) {
      throw new ForkableError(`${opLabel}: GraphQL errors: ${JSON.stringify(res.errors)}`);
    }
    return res.data;
  }
}
