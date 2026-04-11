import type { Logger } from "../logging/types.js";
import type { HookRegistration, MaybePromise } from "./types.js";

export type HookFn<TContext> = (context: TContext) => MaybePromise<void>;

export interface HookRunnerOptions {
  logger?: Logger;
}

export interface HookRunner<THooks> {
  run<TContext>(
    hookName: string,
    selectHook: (hooks: THooks) => HookFn<TContext> | undefined,
    context: TContext,
  ): Promise<void>;
  runErrorHook<TContext>(
    hookName: string,
    selectHook: (hooks: THooks) => HookFn<TContext> | undefined,
    context: TContext,
  ): Promise<void>;
}

export function createHookRunner<THooks>(
  registrations: ReadonlyArray<HookRegistration<THooks>> = [],
  options: HookRunnerOptions = {},
): HookRunner<THooks> {
  return {
    async run<TContext>(
      hookName: string,
      selectHook: (hooks: THooks) => HookFn<TContext> | undefined,
      context: TContext,
    ): Promise<void> {
      for (const registration of registrations) {
        const hook = selectHook(registration.hooks);
        if (!hook) {
          continue;
        }

        try {
          await hook(context);
        } catch (error) {
          await logHookFailure(options.logger, hookName, registration.name, error);
          throw error;
        }
      }
    },

    async runErrorHook<TContext>(
      hookName: string,
      selectHook: (hooks: THooks) => HookFn<TContext> | undefined,
      context: TContext,
    ): Promise<void> {
      for (const registration of registrations) {
        const hook = selectHook(registration.hooks);
        if (!hook) {
          continue;
        }

        try {
          await hook(context);
        } catch (error) {
          await logHookFailure(options.logger, hookName, registration.name, error);
        }
      }
    },
  };
}

async function logHookFailure(
  logger: Logger | undefined,
  hookName: string,
  registrationName: string,
  error: unknown,
): Promise<void> {
  await logger?.error(
    "plugin hook failed",
    {
      hookName,
      hookRegistrationName: registrationName,
      errorType: error instanceof Error ? error.name : typeof error,
    },
    error instanceof Error ? error : new Error(String(error ?? "Unknown hook error")),
  );
}
