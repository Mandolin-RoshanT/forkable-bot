// HTTP constants live in src/lib/constants.ts (single source of truth);
// this file re-exports them and adds spike-only on-disk paths.

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export { BROWSER_HEADERS, FORKABLE_GRAPHQL } from '../../src/lib/constants.ts';

// Paths relative to this file so the spike script works from any cwd.
const LIB_DIR = dirname(fileURLToPath(import.meta.url));
const SCRIPTS_DIR = resolve(LIB_DIR, '..');
export const CAPTURES_DIR = resolve(SCRIPTS_DIR, 'captures');
export const RAW_DIR = resolve(CAPTURES_DIR, 'raw');
