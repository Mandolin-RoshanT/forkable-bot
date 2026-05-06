// Subcommand dispatcher. Routes argv to the matching command. Each
// command lives in src/commands/ and owns its own settings/client wiring.

import { runPicker } from './commands/run-picker.ts';
import { showWeek } from './commands/show-week.ts';

export async function run(argv: string[]): Promise<number> {
  const cmd = argv[2];
  switch (cmd) {
    case 'show-week':
      return showWeek(argv.slice(3));
    case 'dry-run':
      return runPicker(argv.slice(3), { dryRun: true });
    case 'pick':
      return runPicker(argv.slice(3), { dryRun: false });
    default:
      console.error('usage: bun src/index.ts <show-week | dry-run | pick> [YYYY-MM-DD]');
      return 1;
  }
}
