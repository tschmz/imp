import type { Command } from "commander";

export function addConfigOption(command: Command): Command {
  return command.option("-c, --config <path>", "Path to the config file");
}

export function withAsyncAction<TArgs extends unknown[]>(
  action: (...args: TArgs) => Promise<void>,
): (...args: TArgs) => Promise<void> {
  return async (...args: TArgs) => action(...args);
}

export function booleanWithDefault(value: boolean | undefined, defaultValue: boolean): boolean {
  return value ?? defaultValue;
}
