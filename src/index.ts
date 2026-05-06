import { run } from './cli.ts';

try {
  process.exit(await run(process.argv));
} catch (err) {
  console.error(`[forkable-bot] FAILED: ${(err as Error).message}`);
  process.exit(1);
}
