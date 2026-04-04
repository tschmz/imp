import { createDaemon } from "./daemon/create-daemon.js";
import { loadConfigFromEnv } from "./config/load-config.js";

async function main(): Promise<void> {
  const daemon = createDaemon(loadConfigFromEnv());
  await daemon.start();
}

main().catch((error: unknown) => {
  console.error("daemon failed to start");
  console.error(error);
  process.exitCode = 1;
});
