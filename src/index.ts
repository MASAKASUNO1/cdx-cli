#!/usr/bin/env node

import { executeRun } from "./commands/run.js";

const USAGE = `cdx-cli - Codex SDK wrapper CLI

Usage:
  cdx-cli run [options] "prompt"

Options:
  --workdir, -w <path>       Working directory (required)
  --instructions, -i <path>  Instructions file
  --trace-file <path>        Trace output path
  --agent-id <id>            Agent ID
  --agent-type <type>        Agent type (freeform)
  --model, -m <model>        Model override
  --thinking <effort>        Model reasoning effort (low|medium|high|xhigh)
`;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === "--help" || command === "-h") {
    process.stderr.write(USAGE);
    process.exit(command ? 0 : 1);
  }

  switch (command) {
    case "run":
      await executeRun(args.slice(1));
      break;
    default:
      process.stderr.write(`Unknown command: ${command}\n\n${USAGE}`);
      process.exit(1);
  }
}

main();
