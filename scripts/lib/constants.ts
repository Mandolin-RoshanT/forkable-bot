import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const FORKABLE_GRAPHQL = 'https://forkable.com/api/v2/graphql';

// Origin/Referer satisfy CSRF; Forkable-Referrer is required by the server.
export const BROWSER_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
  Accept: 'application/json',
  Origin: 'https://forkable.com',
  Referer: 'https://forkable.com/mc/',
  'Forkable-Referrer': 'mc',
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
};

// Paths relative to this file so the script works from any cwd.
const LIB_DIR = dirname(fileURLToPath(import.meta.url));
const SCRIPTS_DIR = resolve(LIB_DIR, '..');
export const CAPTURES_DIR = resolve(SCRIPTS_DIR, 'captures');
export const RAW_DIR = resolve(CAPTURES_DIR, 'raw');
