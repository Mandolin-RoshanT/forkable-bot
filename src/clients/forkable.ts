// ForkableClient: stateful wrapper around forkable.com's GraphQL API.
//
// Owns the cookie jar internally; callers get high-level methods that return
// already-validated domain objects. Each network response is parsed by its
// matching Zod schema — schema drift surfaces as a typed error here, not as
// a silent `undefined` deeper in the picker.

import type { z } from 'zod';

import { DEFAULT_FORKABLE_TIMEOUT_MS } from '../config.ts';
import { CookieJar } from '../lib/cookie-jar.ts';
import { errorMessage } from '../lib/error-message.ts';
import type { FetchFn } from '../lib/fetch.ts';
import { LOG_EVENTS } from '../lib/log-events.ts';
import { redactCookie } from '../lib/redact.ts';
import type { Logger } from '../logger.ts';
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
import { ForkableError } from './forkable-errors.ts';

// Single source of truth for the Forkable HTTP surface. Origin/Referer
// satisfy CSRF; Forkable-Referrer is required by the server.
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

export type ForkableCreds = { email: string; password: string };

export type ForkableClientOptions = {
  fetchFn?: FetchFn;
  timeoutMs?: number;
};

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
  private readonly fetchFn: FetchFn;
  private readonly timeoutMs: number;

  constructor(
    private readonly creds: ForkableCreds,
    private readonly logger: Logger,
    opts: ForkableClientOptions = {},
  ) {
    // Bind so callers can still invoke as a free function (browser-style
    // fetch unbinds `this` when stored in a variable).
    this.fetchFn = opts.fetchFn ?? globalThis.fetch.bind(globalThis);
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_FORKABLE_TIMEOUT_MS;
  }

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

    const parsed = this.parseOrThrow(CreateSessionResponseSchema, raw, 'CreateSession');
    const session = parsed.createSession;

    if (!session.user) {
      throw new ForkableError({
        kind: 'auth',
        message: 'createSession returned no user',
        body: {
          errorAttributes: session.errorAttributes,
          errorDetails: session.errorDetails,
        },
        context: { operation: 'createSession' },
      });
    }
    if (session.user.mfaEnabled) {
      throw new ForkableError({
        kind: 'auth',
        message: 'MFA is enabled — bot cannot proceed (PRD §7.1)',
        context: { operation: 'createSession' },
      });
    }

    const sessionCookie = this.extractSessionCookie(beforeLogin);

    this.logger.info(LOG_EVENTS.FORKABLE_LOGIN_OK, { user: session.user.id });
    this.logger.info(LOG_EVENTS.FORKABLE_SESSION_COOKIE, {
      name: sessionCookie.name,
      value: redactCookie(sessionCookie.value),
    });

    this.loggedInUser = session.user;
    return session.user;
  }

  async me(): Promise<ForkableUser> {
    this.requireLogin('me');
    const raw = await this.post({ operationName: 'Me', query: ME_QUERY }, 'Me');
    const parsed = this.parseOrThrow(MeResponseSchema, raw, 'Me');
    if (!parsed.me) {
      throw new ForkableError({
        kind: 'auth',
        message: 'me returned null — session cookie not accepted',
        context: { operation: 'me' },
      });
    }
    this.logger.info(LOG_EVENTS.FORKABLE_ME_OK, { user: parsed.me.id });
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
    const parsed = this.parseOrThrow(GetWeekResponseSchema, raw, 'GetWeek');
    return parsed.myDeliveries;
  }

  async getAlternatives(menuIds: number[], clubId: number): Promise<Menu[]> {
    this.requireLogin('getAlternatives');
    const variables: GetAlternativesVariables = { ids: menuIds, clubId };
    const raw = await this.post(
      { operationName: 'GetAlternatives', query: GET_ALTERNATIVES_QUERY, variables },
      'GetAlternatives',
    );
    const parsed = this.parseOrThrow(GetAlternativesResponseSchema, raw, 'GetAlternatives');
    return parsed.menus;
  }

  // Swap the user's chosen piece for a different (menu, item) on the same day.
  // Per locked v1 decision: selectionsHash={} (server fills modifier defaults).
  // Throws ForkableError (kind: 'network' | 'schema' | 'graphql') on failure;
  // caller catches per-day so a single bad swap can't kill the run.
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
    this.parseOrThrow(ReplacePieceResponseSchema, raw, 'ReplacePiece');
    this.logger.info(LOG_EVENTS.FORKABLE_REPLACE_OK, {
      delivery: args.deliveryId,
      menu: args.menuId,
      item: args.itemId,
    });
  }

  // ─── private ─────────────────────────────────────────────────────────────

  private requireLogin(method: string): void {
    if (!this.loggedInUser) {
      throw new ForkableError({
        kind: 'auth',
        message: `must login() before calling ${method}()`,
        context: { operation: method },
      });
    }
  }

  // Find the cookie that createSession added to the jar (the named one
  // containing "session" if present, otherwise the first new cookie).
  // Throws if createSession set no new cookies — that would mean the auth
  // flow is broken upstream.
  private extractSessionCookie(beforeLogin: Set<string>): { name: string; value: string } {
    const newCookies = this.jar.diff(beforeLogin);
    const name = newCookies.find((n) => n.toLowerCase().includes('session')) ?? newCookies[0];
    if (!name) {
      throw new ForkableError({
        kind: 'auth',
        message: 'createSession set no new cookies — auth flow broken',
        context: { operation: 'createSession' },
      });
    }
    const value = this.jar.get(name) ?? '';
    return { name, value };
  }

  // Fetch with an AbortController-backed timeout. On timeout, throws a
  // network-kind ForkableError carrying the operation, URL, and configured
  // timeoutMs. Non-timeout fetch failures (DNS, connection refused, etc.)
  // are also wrapped so callers never see a raw TypeError.
  private async fetchWithTimeout(
    url: string,
    init: RequestInit,
    operation: string,
  ): Promise<Response> {
    const ctl = new AbortController();
    const timeoutId = setTimeout(() => ctl.abort(), this.timeoutMs);
    try {
      return await this.fetchFn(url, { ...init, signal: ctl.signal });
    } catch (err) {
      if (ctl.signal.aborted) {
        throw new ForkableError({
          kind: 'network',
          message: `${operation}: request timed out after ${this.timeoutMs}ms`,
          context: { operation, url, timeoutMs: this.timeoutMs },
          cause: err,
        });
      }
      throw new ForkableError({
        kind: 'network',
        message: `${operation}: ${errorMessage(err)}`,
        context: { operation, url },
        cause: err,
      });
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // Run a zod schema against an upstream response and wrap any ZodError as
  // a schema-kind ForkableError carrying the operation name and the raw
  // payload. Preserves the ZodError as `cause` so the path info is intact
  // for the schema-drift recovery flow.
  private parseOrThrow<T>(schema: z.ZodType<T>, raw: unknown, operation: string): T {
    try {
      return schema.parse(raw);
    } catch (err) {
      throw new ForkableError({
        kind: 'schema',
        message: `${operation}: response did not match schema`,
        body: raw,
        context: { operation },
        cause: err,
      });
    }
  }

  // Anonymous POST → expected 401, seeds AWS ALB sticky-session cookies.
  private async warmup(): Promise<void> {
    const before = this.jar.size;
    const res = await this.fetchWithTimeout(
      FORKABLE_GRAPHQL,
      {
        method: 'POST',
        headers: BROWSER_HEADERS,
        body: JSON.stringify({ query: '{__typename}' }),
      },
      'warmup',
    );
    await res.text();
    this.jar.add(res.headers);
    const captured = this.jar.size - before;
    this.logger.info(LOG_EVENTS.FORKABLE_WARMUP, {
      status: res.status,
      stickyCookies: captured,
    });
  }

  // Public escape hatch for capture-ops and any future ad-hoc tooling.
  // Returns the full GraphQL response, errors and all — perfect for replay
  // or probing where you want to inspect what the server said. Network
  // errors (non-2xx) and malformed JSON still throw.
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
    this.logger.debug(LOG_EVENTS.FORKABLE_POST_OUT, { op: opLabel, cookies: cookieNames });

    const res = await this.fetchWithTimeout(
      FORKABLE_GRAPHQL,
      {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      },
      opLabel,
    );
    this.jar.add(res.headers);

    const text = await res.text();
    this.logger.debug(LOG_EVENTS.FORKABLE_POST_IN, {
      op: opLabel,
      status: res.status,
      statusText: res.statusText,
      bytes: text.length,
    });

    if (!res.ok) {
      throw new ForkableError({
        kind: 'network',
        message: `${opLabel}: HTTP ${res.status} ${res.statusText}`,
        status: res.status,
        body: text.slice(0, 500),
        context: {
          operation: opLabel,
          url: FORKABLE_GRAPHQL,
          statusText: res.statusText,
        },
      });
    }

    try {
      return JSON.parse(text) as GraphQLResponse;
    } catch (err) {
      throw new ForkableError({
        kind: 'schema',
        message: `${opLabel}: response was not valid JSON`,
        body: text.slice(0, 500),
        context: { operation: opLabel },
        cause: err,
      });
    }
  }

  // Adds the throw-on-response.errors check on top of postRaw — what the
  // typed methods (login, me, getWeek, getAlternatives) want.
  private async post(body: GraphQLBody, opLabel: string): Promise<unknown> {
    const res = await this.postRaw(body, opLabel);
    if (res.errors && res.errors.length > 0) {
      throw new ForkableError({
        kind: 'graphql',
        message: `${opLabel}: GraphQL errors`,
        body: res.errors,
        context: { operation: opLabel },
      });
    }
    return res.data;
  }
}
