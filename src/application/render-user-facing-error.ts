import { ConfigurationError, RuntimeStateError, TransportResolutionError } from "../domain/errors.js";
import {
  modelProviderFailureKindToProcessingErrorKind,
  UserVisibleProcessingError,
  type UserVisibleProcessingErrorKind,
} from "../domain/processing-error.js";
import { AgentExecutionError } from "../runtime/agent-execution.js";

const maxVisibleDetailLength = 180;
const sensitiveDetailPattern = /(?:api[_-]?key|token|secret|password|authorization|bearer|cookie)/i;
const longOpaqueTokenPattern = /[A-Za-z0-9_-]{33,}/;

export function renderUserFacingError(error: unknown): string {
  if (error instanceof UserVisibleProcessingError) {
    return renderTypedProcessingError(error.kind, error.message);
  }

  if (error instanceof ConfigurationError) {
    return withReason(
      "I couldn't process your message because the configuration is invalid.",
      getSafeDetail(error.message),
    );
  }

  if (error instanceof TransportResolutionError) {
    return withReason(
      "I couldn't process your message because the transport configuration is invalid or unsupported.",
      getSafeDetail(error.message),
    );
  }

  if (error instanceof RuntimeStateError) {
    return withReason(
      "I couldn't process your message because runtime state is unavailable.",
      getSafeDetail(error.message),
    );
  }

  if (error instanceof AgentExecutionError) {
    return renderAgentExecutionError(error);
  }

  if (isTimeoutError(error)) {
    return withReason(
      "I couldn't process your message because an internal operation timed out.",
      getSafeDetail(getErrorMessage(error)),
    );
  }

  const errorMessage = getErrorMessage(error);
  const classifiedErrorMessage = getClassifiedGenericErrorMessage(errorMessage);
  const detail = getSafeDetail(errorMessage);
  if (classifiedErrorMessage) {
    return withReason(classifiedErrorMessage, detail);
  }

  if (detail) {
    return withReason("I couldn't process your message.", detail);
  }

  return "I couldn't process your message because an unexpected error occurred.";
}

function withReason(message: string, detail?: string): string {
  return detail ? `${message}\nReason: ${detail}` : message;
}

function renderAgentExecutionError(error: AgentExecutionError): string {
  const rawDetail = error.details.upstreamErrorMessage ?? error.message;
  return renderTypedProcessingError(
    modelProviderFailureKindToProcessingErrorKind(error.details.upstreamFailureKind),
    rawDetail,
  );
}

function renderTypedProcessingError(kind: UserVisibleProcessingErrorKind, rawDetail: string | undefined): string {
  return withReason(getTypedProcessingErrorMessage(kind), getSafeDetail(rawDetail));
}

function getTypedProcessingErrorMessage(kind: UserVisibleProcessingErrorKind): string {
  switch (kind) {
    case "model_provider_authentication":
      return "I couldn't generate a response because the model provider rejected the credentials.";
    case "model_provider_rate_limit":
      return "I couldn't generate a response because the model provider rate limit was reached.";
    case "model_provider_temporary_availability":
      return "I couldn't generate a response because the model provider is temporarily unavailable.";
    case "model_provider_timeout":
      return "I couldn't generate a response because the model provider request timed out.";
    case "model_provider_error":
      return "I couldn't generate a response because the model provider returned an error.";
    case "tool_command_execution":
      return "I couldn't process your message because a tool or command failed.";
    case "file_document_persistence":
      return "I couldn't process your message because a file or document operation failed.";
    case "permission_denied":
      return "I couldn't process your message because access was denied.";
    case "network_connectivity":
      return "I couldn't process your message because a network connection failed.";
  }
}

function getClassifiedGenericErrorMessage(detail: string | undefined): string | undefined {
  if (matchesAny(detail, [
    /\b(?:permission denied|access denied|eacces|eperm|forbidden|not authorized|unauthorized)\b/i,
  ])) {
    return "I couldn't process your message because access was denied.";
  }

  if (matchesAny(detail, [
    /\b(?:enotfound|eai_again|econnreset|econnrefused|socket hang up|network|dns|connection refused|connection reset|fetch failed)\b/i,
  ])) {
    return "I couldn't process your message because a network connection failed.";
  }

  if (matchesAny(detail, [
    /\b(?:command failed|command exited|exit code|spawn .* enoent|tool execution|tool call|shell command)\b/i,
  ])) {
    return "I couldn't process your message because a tool or command failed.";
  }

  if (matchesAny(detail, [
    /\b(?:download|document|attachment|file upload|persist|store|write file|read file|enoent|enospc|disk)\b/i,
  ])) {
    return "I couldn't process your message because a file or document operation failed.";
  }

  if (matchesAny(detail, [
    /\b(?:invalid configuration|configuration invalid|config|missing required|invalid option|missing api key)\b/i,
  ])) {
    return "I couldn't process your message because the configuration is invalid.";
  }

  return undefined;
}

function getSafeDetail(detail: string | undefined): string | undefined {
  if (!detail || /[\r\n]/.test(detail)) {
    return undefined;
  }

  const normalized = detail.trim().replace(/\s+/g, " ");
  if (normalized.length === 0 || normalized.length > maxVisibleDetailLength) {
    return undefined;
  }

  if (
    sensitiveDetailPattern.test(normalized)
    || longOpaqueTokenPattern.test(normalized)
  ) {
    return undefined;
  }

  return normalized;
}

function getErrorMessage(error: unknown): string | undefined {
  return error instanceof Error ? error.message : undefined;
}

function isTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return error.name === "AbortError"
    || /timeout|timed out|etimedout/i.test(error.message)
    || /timeout|timed out/i.test(error.name);
}

function matchesAny(detail: string | undefined, patterns: RegExp[]): boolean {
  return detail !== undefined && patterns.some((pattern) => pattern.test(detail));
}
