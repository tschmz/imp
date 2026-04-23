export type ModelProviderFailureKind =
  | "authentication"
  | "rate_limit"
  | "temporary_availability"
  | "timeout"
  | "unknown";

export type UserVisibleProcessingErrorKind =
  | "model_provider_authentication"
  | "model_provider_rate_limit"
  | "model_provider_temporary_availability"
  | "model_provider_timeout"
  | "model_provider_error"
  | "tool_command_execution"
  | "file_document_persistence"
  | "permission_denied"
  | "network_connectivity";

export class UserVisibleProcessingError extends Error {
  readonly kind: UserVisibleProcessingErrorKind;

  constructor(kind: UserVisibleProcessingErrorKind, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "UserVisibleProcessingError";
    this.kind = kind;
  }
}

export function modelProviderFailureKindToProcessingErrorKind(
  kind: ModelProviderFailureKind,
): UserVisibleProcessingErrorKind {
  switch (kind) {
    case "authentication":
      return "model_provider_authentication";
    case "rate_limit":
      return "model_provider_rate_limit";
    case "temporary_availability":
      return "model_provider_temporary_availability";
    case "timeout":
      return "model_provider_timeout";
    case "unknown":
      return "model_provider_error";
  }
}

export function classifyModelProviderFailure(detail: string | undefined): ModelProviderFailureKind {
  if (matchesAny(detail, [
    /\b(?:401|unauthorized|authentication|auth|credential|invalid api key|incorrect api key|missing api key|no api key)\b/i,
  ])) {
    return "authentication";
  }

  if (matchesAny(detail, [
    /\b(?:429|rate limit|rate_limit|too many requests|quota|insufficient_quota)\b/i,
  ])) {
    return "rate_limit";
  }

  if (matchesAny(detail, [
    /\b(?:500|502|503|504|service unavailable|bad gateway|gateway timeout|overloaded|temporarily unavailable)\b/i,
  ])) {
    return "temporary_availability";
  }

  if (matchesAny(detail, [
    /\b(?:timeout|timed out|etimedout|abort(?:ed)?)\b/i,
  ])) {
    return "timeout";
  }

  return "unknown";
}

function matchesAny(detail: string | undefined, patterns: RegExp[]): boolean {
  return detail !== undefined && patterns.some((pattern) => pattern.test(detail));
}
