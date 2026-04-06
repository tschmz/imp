export type ServiceErrorCode = "unsupported" | "not_installed" | "permission_denied";

export class ServiceOperationError extends Error {
  constructor(
    public readonly code: ServiceErrorCode,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "ServiceOperationError";
  }
}

export function mapServiceError(error: unknown): ServiceOperationError {
  if (error instanceof ServiceOperationError) {
    return error;
  }

  if (isPermissionError(error)) {
    return new ServiceOperationError(
      "permission_denied",
      "Insufficient permissions to manage the service.",
      error,
    );
  }

  if (isMissingServiceError(error)) {
    return new ServiceOperationError("not_installed", getErrorMessage(error), error);
  }

  if (isUnsupportedError(error)) {
    return new ServiceOperationError("unsupported", getErrorMessage(error), error);
  }

  throw error;
}

function isPermissionError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  if ("code" in error && (error.code === "EACCES" || error.code === "EPERM")) {
    return true;
  }

  const message = getErrorMessage(error).toLowerCase();
  return message.includes("permission denied") || message.includes("operation not permitted");
}

function isMissingServiceError(error: unknown): boolean {
  return getErrorMessage(error).toLowerCase().includes("service definition not found");
}

function isUnsupportedError(error: unknown): boolean {
  return getErrorMessage(error).toLowerCase().includes("not implemented yet");
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
