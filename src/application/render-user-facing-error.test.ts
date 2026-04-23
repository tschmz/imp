import { describe, expect, it } from "vitest";
import { ConfigurationError, RuntimeStateError, TransportResolutionError } from "../domain/errors.js";
import { UserVisibleProcessingError } from "../domain/processing-error.js";
import { AgentExecutionError } from "../runtime/agent-execution.js";
import { renderUserFacingError } from "./render-user-facing-error.js";

describe("renderUserFacingError", () => {
  it("returns a specific message for invalid configuration errors", () => {
    expect(renderUserFacingError(new ConfigurationError("Missing provider configuration."))).toBe(
      "I couldn't process your message because the configuration is invalid.\nReason: Missing provider configuration.",
    );
  });

  it("returns a specific message for transport resolution errors", () => {
    expect(renderUserFacingError(new TransportResolutionError("No transport matched endpoint \"telegram\"."))).toBe(
      "I couldn't process your message because the transport configuration is invalid or unsupported.\nReason: No transport matched endpoint \"telegram\".",
    );
  });

  it("returns a specific message for runtime state errors", () => {
    expect(renderUserFacingError(new RuntimeStateError("Conversation state lock could not be acquired."))).toBe(
      "I couldn't process your message because runtime state is unavailable.\nReason: Conversation state lock could not be acquired.",
    );
  });

  it("returns rate limit details for agent execution errors", () => {
    expect(renderUserFacingError(new AgentExecutionError({
      agentId: "jarvis",
      stopReason: "error",
      upstreamErrorMessage: "OpenAI request failed with status 429.",
      upstreamProvider: "openai",
      upstreamModel: "gpt-5",
      upstreamApi: "responses",
      upstreamFailureKind: "rate_limit",
      assistantContentTypes: [],
      assistantTextLength: 0,
      assistantToolCallNames: [],
      assistantHasThinking: false,
    }))).toBe(
      "I couldn't generate a response because the model provider rate limit was reached.\nReason: OpenAI request failed with status 429.",
    );
  });

  it("classifies model provider authentication errors without leaking sensitive details", () => {
    expect(renderUserFacingError(new AgentExecutionError({
      agentId: "jarvis",
      stopReason: "error",
      upstreamErrorMessage: "Authentication failed for API key sk_live_12345678901234567890123456789012345.",
      upstreamProvider: "openai",
      upstreamModel: "gpt-5",
      upstreamApi: "responses",
      upstreamFailureKind: "authentication",
      assistantContentTypes: [],
      assistantTextLength: 0,
      assistantToolCallNames: [],
      assistantHasThinking: false,
    }))).toBe("I couldn't generate a response because the model provider rejected the credentials.");
  });

  it("classifies temporary model provider service errors", () => {
    expect(renderUserFacingError(new AgentExecutionError({
      agentId: "jarvis",
      stopReason: "error",
      upstreamErrorMessage: "Provider returned 503 service unavailable.",
      upstreamProvider: "openai",
      upstreamModel: "gpt-5",
      upstreamApi: "responses",
      upstreamFailureKind: "temporary_availability",
      assistantContentTypes: [],
      assistantTextLength: 0,
      assistantToolCallNames: [],
      assistantHasThinking: false,
    }))).toBe(
      "I couldn't generate a response because the model provider is temporarily unavailable.\nReason: Provider returned 503 service unavailable.",
    );
  });

  it("returns a timeout-specific message", () => {
    const error = new Error("Tool execution timed out after 30000ms.");
    error.name = "AbortError";

    expect(renderUserFacingError(error)).toBe(
      "I couldn't process your message because an internal operation timed out.\nReason: Tool execution timed out after 30000ms.",
    );
  });

  it("classifies configuration failures without leaking sensitive details", () => {
    expect(renderUserFacingError(new Error("Missing API key sk_live_12345678901234567890123456789012345"))).toBe(
      "I couldn't process your message because the configuration is invalid.",
    );
  });

  it("keeps missing provider credentials in the authentication bucket", () => {
    expect(renderUserFacingError(new AgentExecutionError({
      agentId: "jarvis",
      stopReason: "error",
      upstreamErrorMessage: "No API key for provider: faux",
      upstreamProvider: "faux",
      upstreamModel: "faux-1",
      upstreamApi: "responses",
      upstreamFailureKind: "authentication",
      assistantContentTypes: [],
      assistantTextLength: 0,
      assistantToolCallNames: [],
      assistantHasThinking: false,
    }))).toBe(
      "I couldn't generate a response because the model provider rejected the credentials.\nReason: No API key for provider: faux",
    );
  });

  it("classifies tool and command failures with a safe detail", () => {
    expect(renderUserFacingError(new UserVisibleProcessingError(
      "tool_command_execution",
      "Shell command exited with code 127.",
    ))).toBe(
      "I couldn't process your message because a tool or command failed.\nReason: Shell command exited with code 127.",
    );
  });

  it("classifies file and document failures with a safe detail", () => {
    expect(renderUserFacingError(new UserVisibleProcessingError(
      "file_document_persistence",
      "Document download failed before it could be stored.",
    ))).toBe(
      "I couldn't process your message because a file or document operation failed.\nReason: Document download failed before it could be stored.",
    );
  });

  it("classifies permission failures with a safe detail", () => {
    expect(renderUserFacingError(new UserVisibleProcessingError(
      "permission_denied",
      "EACCES: permission denied, mkdir '/var/lib/app'",
    ))).toBe(
      "I couldn't process your message because access was denied.\nReason: EACCES: permission denied, mkdir '/var/lib/app'",
    );
  });

  it("classifies network failures with a safe detail", () => {
    expect(renderUserFacingError(new UserVisibleProcessingError(
      "network_connectivity",
      "fetch failed: ECONNRESET",
    ))).toBe(
      "I couldn't process your message because a network connection failed.\nReason: fetch failed: ECONNRESET",
    );
  });

  it("keeps generic fallback classification for unstructured errors", () => {
    expect(renderUserFacingError(new Error("Shell command exited with code 127."))).toBe(
      "I couldn't process your message because a tool or command failed.\nReason: Shell command exited with code 127.",
    );
  });

  it("returns a generic message with a safe detail for unknown errors", () => {
    expect(renderUserFacingError(new Error("Unexpected empty response."))).toBe(
      "I couldn't process your message.\nReason: Unexpected empty response.",
    );
  });

  it("does not leak sensitive typed error details", () => {
    expect(renderUserFacingError(new UserVisibleProcessingError(
      "network_connectivity",
      "Authorization bearer abcdefghijklmnopqrstuvwxyzABCDEFG failed",
    ))).toBe("I couldn't process your message because a network connection failed.");
  });
});
