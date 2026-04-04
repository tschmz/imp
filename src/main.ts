import { parseCliArgs } from "./cli/parse-cli-args.js";
import { loadAppConfig } from "./config/load-app-config.js";
import { resolveRuntimeConfig } from "./config/resolve-runtime-config.js";
import { createDaemon } from "./daemon/create-daemon.js";

async function main(): Promise<void> {
  const args = parseCliArgs();
  const appConfig = await loadAppConfig(args.configPath);
  const daemon = createDaemon(resolveRuntimeConfig(appConfig, args.configPath));
  await daemon.start();
}

main().catch((error: unknown) => {
  console.error("daemon failed to start");
  console.error(error);
  process.exitCode = 1;
});
