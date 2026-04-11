import type { InboundProcessingContext } from "./types.js";

export async function runHooksSuccess(context: InboundProcessingContext): Promise<void> {
  if (!context.response) {
    return;
  }

  await context.hookRunner.run(
    "onInboundMessageSuccess",
    (hooks) => hooks.onInboundMessageSuccess,
    {
      message: context.message,
      response: context.response,
      durationMs: Date.now() - context.startedAt,
    },
  );
}

export async function runHooksError(
  context: InboundProcessingContext,
  error: unknown,
): Promise<void> {
  await context.hookRunner.runErrorHook(
    "onInboundMessageError",
    (hooks) => hooks.onInboundMessageError,
    {
      message: context.message,
      error,
      durationMs: Date.now() - context.startedAt,
    },
  );
}
