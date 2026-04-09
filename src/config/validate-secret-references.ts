import { dirname } from "node:path";
import { resolveSecretValue } from "./secret-value.js";
import type { AppConfig } from "./types.js";

interface ValidateSecretReferencesOptions {
  env?: NodeJS.ProcessEnv;
  readTextFile?: (path: string) => Promise<string>;
}

export async function validateAppConfigSecretReferences(
  appConfig: AppConfig,
  configPath: string,
  options: ValidateSecretReferencesOptions = {},
): Promise<void> {
  const configDir = dirname(configPath);

  await Promise.all(
    appConfig.bots.map(async (bot, index) => {
      await resolveSecretValue(bot.token, {
        configDir,
        env: options.env,
        readTextFile: options.readTextFile,
        fieldLabel: `bots.${index}.token`,
      });
    }),
  );
}
