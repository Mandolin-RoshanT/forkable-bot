// Shared MSW scaffolding for integration tests. Each test file calls
// createTestServer() once at the top level to get a fresh server with
// lifecycle hooks already bound; everything else (graphqlHandler, response
// builders, common constants) avoids reproducing the same boilerplate
// across forkable.test.ts / e2e.test.ts / cli-failure.test.ts.

import { afterAll, afterEach, beforeAll } from 'bun:test';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import type { Logger } from '../../src/logger.ts';

export const FORKABLE_GRAPHQL = 'https://forkable.com/api/v2/graphql';
export const RESEND_ENDPOINT = 'https://api.resend.com/emails';

export const silentLogger: Logger = {
  info: () => {},
  error: () => {},
  debug: () => {},
};

export const VALID_USER = { id: 305827, email: 'test@example.com', mfaEnabled: false };

export const SESSION_COOKIE_HEADERS = {
  'Set-Cookie': '_easyorder_session=session-cookie-aaa; Path=/; HttpOnly',
};

const WARMUP_COOKIE_HEADERS = {
  'Set-Cookie': 'AWSALBTG=warmup-cookie; Path=/',
};

export function createTestServer(opts: { onUnhandledRequest?: 'error' | 'bypass' } = {}) {
  const server = setupServer();
  beforeAll(() => server.listen({ onUnhandledRequest: opts.onUnhandledRequest ?? 'error' }));
  afterEach(() => server.resetHandlers());
  afterAll(() => server.close());
  return server;
}

// Single forkable.com handler that dispatches by operationName, with the
// warmup 401 (and ALB cookie seeding) baked in as the default. Each test
// passes only the routes it cares about.
export function graphqlHandler(routes: Record<string, () => Response | Promise<Response>>) {
  return http.post(FORKABLE_GRAPHQL, async ({ request }) => {
    const body = (await request.clone().json()) as {
      operationName?: string;
      query: string;
    };
    if (body.query?.includes('__typename')) {
      return new HttpResponse('Unauthorized', {
        status: 401,
        headers: WARMUP_COOKIE_HEADERS,
      });
    }
    const op = body.operationName;
    if (op && routes[op]) {
      return routes[op]();
    }
    return HttpResponse.json({ errors: [{ message: `unhandled op: ${op}` }] });
  });
}

// Common response builders — keep the test bodies focused on what's specific
// to that test rather than re-stating the canned login path.

export function createSessionOk() {
  return HttpResponse.json(
    {
      data: {
        createSession: { user: VALID_USER, errorAttributes: null, errorDetails: null },
      },
    },
    { headers: SESSION_COOKIE_HEADERS },
  );
}

export function meOk() {
  return HttpResponse.json({ data: { me: VALID_USER } });
}
