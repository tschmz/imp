import type { InboundProcessingContext } from "./types.js";

export async function runHooksStart(context: InboundProcessingContext): Promise<void> {
  await context.hookRunner.run(
    "onInboundMessageStart",
    (hooks) => hooks.onInboundMessageStart,
    { message: context.message },
  );
}
