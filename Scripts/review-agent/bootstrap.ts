import { execFileSync } from 'node:child_process';

import { decideBootstrapAction } from './bootstrap-lib.ts';
import {
  QUEUE_FILE,
  STATE_FILE,
  readJson,
  type PersistedState,
  type QueueState,
} from './state-lib.ts';

interface CliOptions {
  repo?: string;
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const state = readJson<PersistedState | null>(STATE_FILE, null);
  const queue = readJson<QueueState | null>(QUEUE_FILE, null);
  const openPrNumbers = listOpenPrNumbers(options.repo);
  const decision = decideBootstrapAction({
    state,
    queue,
    openPrNumbers,
  });

  console.log(JSON.stringify(decision, null, 2));
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {};

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--repo') {
      options.repo = argv[index + 1];
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${value}`);
  }

  return options;
}

function listOpenPrNumbers(repo: string | undefined): number[] {
  const args = ['pr', 'list', '--state', 'open', '--json', 'number', '--limit', '100'];
  if (repo) {
    args.push('--repo', repo);
  }

  const stdout = execFileSync('gh', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  return (JSON.parse(stdout) as Array<{ number: number }>).map((item) => item.number);
}

main();
