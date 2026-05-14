import { run } from './cli.ts';
import { errorMessage } from './lib/error-message.ts';

try {
  process.exit(await run(process.argv));
} catch (err) {
  console.error(`[forkable-bot] FAILED: ${errorMessage(err)}`);
  process.exit(1);
}
