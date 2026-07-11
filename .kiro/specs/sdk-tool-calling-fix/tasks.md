# Implementation Plan: SDK Tool-Calling Pipeline Fix

## Overview

Fix the @kernova/core SDK tool-calling pipeline by ensuring tools flow end-to-end from `completeWithToolLoop` through the ModelRouter and provider to the OpenAI API. Changes span 5 files across the `core` and `types` packages: updating the `ModelMessage` type, adding tool support to `OpenAICompatibleProvider`, routing the 'openai' catalog entry to the dedicated `OpenAIProvider`, fixing finish reason mapping, and updating conversation history in `AgentRegistry`.

## Tasks

- [x] 1. Update ModelMessage type and shared interfaces
  - [x] 1.1 Add `toolCalls` field to `ModelMessage` in `@kernova/types`
    - Open `packages/types/src/model.ts`
    - Add optional `toolCalls?: ToolCall[]` field to the `ModelMessage` interface
    - Ensure `ToolCall` type is already exported or add it (with `id`, `name`, `arguments` fields)
    - Verify the `MessageRole` type includes `'tool'`
    - _Requirements: 6.1_

- [x] 2. Implement OpenAICompatibleProvider tool-calling support
  - [x] 2.1 Add tool forwarding to `OpenAICompatibleProvider` request body
    - Open `packages/core/src/models/openai-compatible-provider.ts`
    - In the `complete()` method, add logic to include `tools` in the API request body when `request.tools` is non-empty
    - Serialize each `ToolSpec` to `{ type: 'function', function: { name, description, parameters } }`
    - Add debug logging: log tool count and names when tools are forwarded
    - Add warning log if tools are undefined/empty but request context suggests tools were expected
    - _Requirements: 1.1, 7.2, 7.4_

  - [x] 2.2 Add tool call message handling to `OpenAICompatibleProvider`
    - In the message mapping logic, add `tool_call_id` when `m.toolCallId` is set
    - Add `tool_calls` serialization when `m.toolCalls` is non-empty (serialize arguments with `JSON.stringify`)
    - _Requirements: 1.2, 5.3_

  - [x] 2.3 Add tool call response parsing to `OpenAICompatibleProvider`
    - Update the `OpenAIStyleResponse` interface to include `tool_calls` on the message
    - Parse `tool_calls` from the API response into `ToolCall[]` on `CompletionResponse.toolCalls`
    - Handle invalid JSON in `arguments` gracefully (catch, default to `{}`, log warning)
    - Add debug logging when tool_calls are parsed from response
    - _Requirements: 1.3, 7.3_

  - [x] 2.4 Fix finish reason mapping in `OpenAICompatibleProvider`
    - Update (or add) a `mapFinishReason` function to handle `"tool_calls"` → `"tool_call"`
    - Ensure return type includes `'tool_call'`
    - _Requirements: 1.4_

  - [ ]* 2.5 Write property test: Tool Spec Serialization Preserves All Fields
    - **Property 1: Tool Spec Serialization Preserves All Fields**
    - **Validates: Requirements 1.1**
    - Create `packages/core/src/__tests__/tool-calling.property.test.ts`
    - Use fast-check to generate random `ToolSpec[]` arrays
    - Serialize using the same logic as `OpenAICompatibleProvider`
    - Assert all fields (name, description, parameters) are preserved through round-trip

  - [ ]* 2.6 Write property test: Tool Call Response Parsing Round-Trip
    - **Property 2: Tool Call Response Parsing Round-Trip**
    - **Validates: Requirements 1.3**
    - Use fast-check to generate random OpenAI-style `tool_calls` responses
    - Parse using the same logic as the provider
    - Assert `id`, `name`, and `arguments` match the original wire format values

- [x] 3. Fix AdapterRegistry provider instantiation
  - [x] 3.1 Route 'openai' catalog entry to dedicated `OpenAIProvider`
    - Open `packages/core/src/models/adapter-registry.ts`
    - In the `case 'openai':` branch of the provider factory, check if `config.id === 'openai'`
    - If yes, instantiate `OpenAIProvider` with `apiKey`, `baseUrl`, `defaultModel`, `timeoutMs`
    - If no (e.g., 'groq', 'together'), continue instantiating `OpenAICompatibleProvider`
    - Import `OpenAIProvider` at the top of the file
    - _Requirements: 2.1, 2.2, 2.3_

  - [ ]* 3.2 Write unit tests for AdapterRegistry provider routing
    - Create or update `packages/core/src/__tests__/adapter-registry.test.ts`
    - Test that `createProviderFromConfig` with `id: 'openai'` returns an `OpenAIProvider` instance
    - Test that `createProviderFromConfig` with `id: 'groq'` and `adapter: 'openai'` returns an `OpenAICompatibleProvider`
    - Test that `detectProvidersFromCatalog` with `OPENAI_API_KEY` env set returns an `OpenAIProvider`
    - _Requirements: 2.1, 2.2, 2.3_

- [x] 4. Fix OpenAIProvider finish reason mapping
  - [x] 4.1 Update `mapFinishReason` in `OpenAIProvider`
    - Open `packages/core/src/models/openai-provider.ts`
    - Update the `mapFinishReason` function to explicitly handle `"tool_calls"` → `"tool_call"`
    - Ensure `"stop"` → `"stop"` and `"length"` → `"length"` are preserved
    - Update the return type to include `'tool_call'`
    - Add debug logging when tool_calls are parsed from response
    - _Requirements: 3.1, 3.2, 3.3, 7.3_

  - [ ]* 4.2 Write unit tests for finish reason mapping
    - Add tests in `packages/core/src/__tests__/openai-provider.test.ts`
    - Test `mapFinishReason("tool_calls")` returns `"tool_call"`
    - Test `mapFinishReason("stop")` returns `"stop"`
    - Test `mapFinishReason("length")` returns `"length"`
    - Test `mapFinishReason(undefined)` returns `"stop"`
    - _Requirements: 3.1, 3.2, 3.3_

- [x] 5. Checkpoint - Ensure provider-level changes compile and tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Update AgentRegistry conversation history handling
  - [x] 6.1 Include `toolCalls` on assistant messages in `completeWithToolLoop`
    - Open `packages/core/src/agents/agent-registry.ts`
    - When pushing the assistant message to conversation history after a tool-call response, include `toolCalls: response.toolCalls`
    - Add debug logging: log tool count and tool names before sending request to ModelRouter
    - _Requirements: 5.1, 5.2, 7.1_

  - [ ]* 6.2 Write property test: Conversation History Serialization Preserves Tool Call Data
    - **Property 4: Conversation History Serialization Preserves Tool Call Data**
    - **Validates: Requirements 1.2, 5.3, 6.2, 6.3**
    - Create or extend `packages/core/src/__tests__/tool-calling.property.test.ts`
    - Use fast-check to generate random `ModelMessage[]` arrays with assistant tool calls and tool results
    - Serialize to OpenAI format and assert `tool_calls`, `tool_call_id`, and `content` are preserved

- [x] 7. Verify ModelRouter field preservation
  - [x] 7.1 Verify ModelRouter passes `tools` field through to provider
    - Open `packages/core/src/models/model-router.ts`
    - Confirm the router uses object spread or pass-through that preserves all `CompletionRequest` fields
    - If not, add `tools` forwarding to both primary and fallback paths
    - _Requirements: 4.1, 4.2, 4.3_

  - [ ]* 7.2 Write property test: ModelRouter Preserves All CompletionRequest Fields
    - **Property 3: ModelRouter Preserves All CompletionRequest Fields**
    - **Validates: Requirements 4.1, 4.2, 4.3**
    - Use fast-check to generate random `CompletionRequest` objects with various optional fields
    - Pass through a mock router instance and verify all fields are forwarded to the provider

- [x] 8. Final checkpoint - Ensure all tests pass and pipeline works end-to-end
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties using fast-check
- Unit tests validate specific examples and edge cases
- The ModelRouter likely already preserves fields via object spread — task 7.1 is primarily verification
- All debug logging uses `console.debug` for normal flow and `console.warn` for the missing-tools case

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["2.1", "2.2", "2.4", "3.1", "4.1"] },
    { "id": 2, "tasks": ["2.3", "2.5", "2.6", "3.2", "4.2"] },
    { "id": 3, "tasks": ["6.1", "7.1"] },
    { "id": 4, "tasks": ["6.2", "7.2"] }
  ]
}
```
