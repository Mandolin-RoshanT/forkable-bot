// On-disk paths for spike capture replay. Resolved relative to this file
// so the script works from any cwd.

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const LIB_DIR = dirname(fileURLToPath(import.meta.url));
const SCRIPTS_DIR = resolve(LIB_DIR, '..');
export const CAPTURES_DIR = resolve(SCRIPTS_DIR, 'captures');
export const RAW_DIR = resolve(CAPTURES_DIR, 'raw');
