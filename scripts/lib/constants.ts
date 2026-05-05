import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const FORKABLE_GRAPHQL = 'https://forkable.com/api/v2/graphql';

// Origin/Referer satisfy the server's CSRF check; the User-Agent dodges
// edge-level "is this curl?" filtering.
export const BROWSER_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
  Accept: 'application/json',
  Origin: 'https://forkable.com',
  Referer: 'https://forkable.com/mc/',
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
};

// Derive paths from this file's location so the script works no matter where
// `bun run spike` is invoked from.
const LIB_DIR = dirname(fileURLToPath(import.meta.url));
const SCRIPTS_DIR = resolve(LIB_DIR, '..');
export const CAPTURES_DIR = resolve(SCRIPTS_DIR, 'captures');
export const RAW_DIR = resolve(CAPTURES_DIR, 'raw');
