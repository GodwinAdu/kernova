# Requirements Document

## Introduction

The @kernova/core SDK has a tool-calling pipeline that fails silently. When `completeWithToolLoop` sends tool definitions through the `ModelRouter` to the model provider, OpenAI never receives the tools and returns plain text responses instead of making function calls. The root cause is a provider mismatch: `detectProvidersFromCatalog()` creates an `OpenAICompatibleProvider` (the generic adapter) for the 'openai' catalog entry, but `OpenAICompatibleProvider` completely ignores the `tools` field in `CompletionRequest`. It does not forward tools to the API, does not parse `tool_calls` from responses, and does not handle `toolCallId` on messages. The dedicated `OpenAIProvider` handles all of this correctly but is never instantiated by the auto-detection path.

This fix ensures tools flow end-to-end from `completeWithToolLoop` through the model router and provider, all the way to the OpenAI API, and that tool call responses are correctly parsed and returned.

## Glossary

- **ModelRouter**: The routing layer (`model-router.ts`) that resolves which provider handles a completion request and forwards the `CompletionRequest` to it.
- **OpenAIProvider**: The dedicated OpenAI provider (`openai-provider.ts`) that correctly implements tool-calling, including sending `tools` in the request body and parsing `tool_calls` from responses.
- **OpenAICompatibleProvider**: The generic provider (`openai-compatible-provider.ts`) used for any service implementing the OpenAI-style chat completions format. Currently lacks tool-calling support.
- **CompletionRequest**: The type (`@kernova/types`) representing a model completion request, including `messages`, `model`, and optional `tools` field.
- **ToolSpec**: The type representing a tool definition sent to the model, containing `name`, `description`, and `parameters`.
- **ToolCall**: The type representing a tool invocation requested by the model, containing `id`, `name`, and `arguments`.
- **completeWithToolLoop**: The method in `AgentRegistry` that implements the iterative tool-calling loop — sends tools to the LLM, executes tool calls, feeds results back, and repeats until the LLM returns a text response.
- **detectProvidersFromCatalog**: The function in `adapter-registry.ts` that auto-detects available model providers from environment variables and creates provider instances using the catalog configuration.
- **AdapterRegistry**: The module (`adapter-registry.ts`) containing the provider catalog and factory functions for creating providers from configuration.
- **ProviderCatalog**: The static map of well-known providers with their adapter type, base URL, API key env var, and capabilities.

## Requirements

### Requirement 1: OpenAICompatibleProvider Tool Forwarding

**User Story:** As an agent developer, I want the OpenAICompatibleProvider to forward tool definitions to the API, so that tool-calling works regardless of which provider instance is used.

#### Acceptance Criteria

1. WHEN a `CompletionRequest` includes a non-empty `tools` array, THE OpenAICompatibleProvider SHALL include those tools in the API request body using OpenAI function-calling format (`{ type: "function", function: { name, description, parameters } }`).
2. WHEN a `CompletionRequest` includes messages with `toolCallId` set, THE OpenAICompatibleProvider SHALL include the `tool_call_id` field on those messages in the API request body.
3. WHEN the API response contains `tool_calls` on the assistant message, THE OpenAICompatibleProvider SHALL parse each tool call and return them as a `ToolCall[]` array in the `CompletionResponse.toolCalls` field.
4. WHEN the API response has a `finish_reason` of `"tool_calls"`, THE OpenAICompatibleProvider SHALL map it to the `"tool_call"` finish reason in `CompletionResponse.metadata.finishReason`.

### Requirement 2: Provider Catalog Uses Dedicated OpenAI Provider

**User Story:** As a platform operator, I want the provider catalog to use the dedicated OpenAIProvider for the 'openai' entry, so that full tool-calling capabilities are available when OpenAI is auto-detected.

#### Acceptance Criteria

1. WHEN `detectProvidersFromCatalog` detects an available `OPENAI_API_KEY`, THE AdapterRegistry SHALL instantiate an `OpenAIProvider` (not an `OpenAICompatibleProvider`) for the 'openai' catalog entry.
2. WHEN an explicit provider configuration has `adapter: 'openai'` and `id: 'openai'`, THE AdapterRegistry SHALL instantiate the dedicated `OpenAIProvider`.
3. WHEN an explicit provider configuration has `adapter: 'openai'` and a non-'openai' id (e.g., 'groq', 'together'), THE AdapterRegistry SHALL continue to instantiate an `OpenAICompatibleProvider`.

### Requirement 3: OpenAIProvider Finish Reason Mapping

**User Story:** As a system integrator, I want the OpenAIProvider to correctly map the `tool_calls` finish reason, so that the response metadata accurately reflects when the model requested tool calls.

#### Acceptance Criteria

1. WHEN the OpenAI API returns a `finish_reason` of `"tool_calls"`, THE OpenAIProvider SHALL map it to `"tool_call"` in the `CompletionResponse.metadata.finishReason` field.
2. WHEN the OpenAI API returns a `finish_reason` of `"stop"`, THE OpenAIProvider SHALL map it to `"stop"`.
3. WHEN the OpenAI API returns a `finish_reason` of `"length"`, THE OpenAIProvider SHALL map it to `"length"`.

### Requirement 4: Tool Field Preservation Through ModelRouter

**User Story:** As an agent developer, I want the ModelRouter to preserve the `tools` field when forwarding requests to providers, so that tools reach the provider regardless of routing path.

#### Acceptance Criteria

1. WHEN a `CompletionRequest` with a `tools` field is passed to `ModelRouter.complete()`, THE ModelRouter SHALL include the `tools` field in the request forwarded to the primary provider.
2. WHEN the primary provider fails and the ModelRouter falls back, THE ModelRouter SHALL include the `tools` field in the fallback request.
3. THE ModelRouter SHALL preserve all fields from the original `CompletionRequest` (including `tools` and `metadata`) when constructing the request sent to any provider.

### Requirement 5: Assistant Messages with Tool Calls in Conversation History

**User Story:** As an agent developer, I want tool call responses properly formatted in conversation history, so that the multi-turn tool-calling loop works correctly with the OpenAI API.

#### Acceptance Criteria

1. WHEN the `completeWithToolLoop` adds an assistant message with tool calls to the conversation history, THE AgentRegistry SHALL include the `tool_calls` field on that message in the format expected by the model provider.
2. WHEN a tool result message is added to the conversation history, THE AgentRegistry SHALL include the `role: "tool"` and `toolCallId` fields so the provider can associate it with the original tool call.
3. WHEN the model provider receives a multi-turn conversation with tool call history, THE OpenAIProvider SHALL format assistant messages with `tool_calls` array and tool messages with `tool_call_id` in the API request.

### Requirement 6: ModelMessage Type Supports Tool Call History

**User Story:** As an SDK developer, I want the `ModelMessage` type to support tool call data on assistant messages, so that multi-turn tool-calling conversations can be represented in the type system.

#### Acceptance Criteria

1. THE `ModelMessage` type in `@kernova/types` SHALL include an optional `toolCalls` field of type `ToolCall[]` for assistant messages that contain tool invocation requests.
2. WHEN a `ModelMessage` has `role: "assistant"` and includes `toolCalls`, THE OpenAIProvider SHALL serialize those tool calls into the OpenAI `tool_calls` format on the message sent to the API.
3. WHEN a `ModelMessage` has `role: "tool"`, THE OpenAIProvider SHALL include both `content` and `tool_call_id` on the message sent to the API.

### Requirement 7: Debug Logging for Tool-Calling Pipeline

**User Story:** As a developer debugging tool-calling issues, I want clear log output at each stage of the tool pipeline, so that I can identify where tools are being dropped.

#### Acceptance Criteria

1. WHEN `completeWithToolLoop` sends a request with tools to the ModelRouter, THE AgentRegistry SHALL log the number of tools and their names at debug level.
2. WHEN the OpenAICompatibleProvider receives a request with tools, THE OpenAICompatibleProvider SHALL log that tools are being forwarded (tool count and names) at debug level.
3. WHEN a provider receives a response with `tool_calls`, THE provider SHALL log the number of tool calls and their names at debug level.
4. IF a `CompletionRequest` has a `tools` field that is `undefined` or empty when it reaches the provider, THEN THE provider SHALL log a warning indicating no tools were received despite the request potentially expecting them.
