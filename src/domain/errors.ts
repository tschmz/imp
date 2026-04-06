export type AppErrorCode =
  | "CONFIG_ERROR"
  | "TRANSPORT_ERROR"
  | "AGENT_EXECUTION_ERROR"
  | "SERVICE_ERROR"
  | "INTERNAL_ERROR";

export interface AppErrorOptions {
  cause?: unknown;
  details?: Record<string, unknown>;
}

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: AppErrorCode, message: string, options: AppErrorOptions = {}) {
    super(message, { cause: options.cause });
    this.name = "AppError";
    this.code = code;
    this.details = options.details;
  }
}

export class ConfigError extends AppError {
  constructor(message: string, options: AppErrorOptions = {}) {
    super("CONFIG_ERROR", message, options);
    this.name = "ConfigError";
  }
}

export class TransportError extends AppError {
  constructor(message: string, options: AppErrorOptions = {}) {
    super("TRANSPORT_ERROR", message, options);
    this.name = "TransportError";
  }
}

export class AgentExecutionError extends AppError {
  constructor(message: string, options: AppErrorOptions = {}) {
    super("AGENT_EXECUTION_ERROR", message, options);
    this.name = "AgentExecutionError";
  }
}

export class ServiceError extends AppError {
  constructor(message: string, options: AppErrorOptions = {}) {
    super("SERVICE_ERROR", message, options);
    this.name = "ServiceError";
  }
}

export type AppResult<T, E extends AppError = AppError> = { ok: true; value: T } | { ok: false; error: E };

export function asAppError(
  error: unknown,
  fallback: { code?: AppErrorCode; message?: string; details?: Record<string, unknown> } = {},
): AppError {
  if (error instanceof AppError) {
    return error;
  }

  if (error instanceof Error) {
    return new AppError(
      fallback.code ?? "INTERNAL_ERROR",
      fallback.message ?? error.message,
      { cause: error, details: fallback.details },
    );
  }

  return new AppError(
    fallback.code ?? "INTERNAL_ERROR",
    fallback.message ?? "Unknown error",
    { cause: error, details: fallback.details },
  );
}
