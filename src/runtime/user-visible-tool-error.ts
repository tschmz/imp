import {
  UserVisibleProcessingError,
  type UserVisibleProcessingErrorKind,
} from "../domain/processing-error.js";

const permissionDeniedCodes = new Set(["EACCES", "EPERM"]);
const networkConnectivityCodes = new Set([
  "EAI_AGAIN",
  "ECONNREFUSED",
  "ECONNRESET",
  "ENETDOWN",
  "ENETUNREACH",
  "ENOTFOUND",
  "ETIMEDOUT",
]);
const fileOperationCodes = new Set([
  "EEXIST",
  "EFBIG",
  "EISDIR",
  "ELOOP",
  "EMFILE",
  "ENOSPC",
  "ENOTDIR",
  "EROFS",
]);

export function createUserVisibleToolError(
  kind: UserVisibleProcessingErrorKind,
  message: string,
): UserVisibleProcessingError {
  return new UserVisibleProcessingError(kind, message);
}

export function toUserVisibleToolError(
  error: unknown,
  options: {
    fallbackMessage: string;
    defaultKind?: UserVisibleProcessingErrorKind;
    classifyFileErrors?: boolean;
  },
): UserVisibleProcessingError {
  if (error instanceof UserVisibleProcessingError) {
    return error;
  }

  const detail = getErrorMessage(error) ?? options.fallbackMessage;
  if (isPermissionDeniedError(error, detail)) {
    return createUserVisibleToolError("permission_denied", detail);
  }

  if (isNetworkConnectivityError(error, detail)) {
    return createUserVisibleToolError("network_connectivity", detail);
  }

  if (options.classifyFileErrors !== false && isFileOperationError(error, detail)) {
    return createUserVisibleToolError("file_document_persistence", detail);
  }

  return createUserVisibleToolError(options.defaultKind ?? "tool_command_execution", detail);
}

function isPermissionDeniedError(error: unknown, message: string): boolean {
  return hasCode(error, permissionDeniedCodes) || /\b(?:permission denied|access denied|forbidden)\b/i.test(message);
}

function isNetworkConnectivityError(error: unknown, message: string): boolean {
  return hasCode(error, networkConnectivityCodes)
    || /\b(?:network|dns|connection refused|connection reset|fetch failed|socket hang up)\b/i.test(message);
}

function isFileOperationError(error: unknown, message: string): boolean {
  return hasCode(error, fileOperationCodes)
    || /\b(?:no such file|not a directory|is a directory|no space left|read-only file system)\b/i.test(message);
}

function hasCode(error: unknown, codes: Set<string>): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && typeof error.code === "string"
    && codes.has(error.code);
}

function getErrorMessage(error: unknown): string | undefined {
  return error instanceof Error ? error.message : undefined;
}
