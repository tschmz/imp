export interface CliArgs {
  command: "start" | "init";
  configPath?: string;
  force: boolean;
}

export function parseCliArgs(argv: string[] = process.argv.slice(2)): CliArgs {
  let command: CliArgs["command"] = "start";
  let configPath: string | undefined;
  let force = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "init") {
      command = "init";
      continue;
    }

    if (arg === "--config") {
      configPath = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg.startsWith("--config=")) {
      configPath = arg.slice("--config=".length);
      continue;
    }

    if (arg === "--force") {
      force = true;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return { command, configPath, force };
}
