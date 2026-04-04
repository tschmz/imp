export interface CliArgs {
  configPath: string;
}

export function parseCliArgs(argv: string[] = process.argv.slice(2)): CliArgs {
  let configPath: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--config") {
      configPath = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg.startsWith("--config=")) {
      configPath = arg.slice("--config=".length);
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!configPath) {
    throw new Error("Missing required argument: --config <path>");
  }

  return { configPath };
}
