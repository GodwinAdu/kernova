# ADR-006: Model-Agnostic Provider Architecture

## Status
Accepted

## Date
July 8, 2026

## Context

The AI model landscape changes rapidly. New providers launch monthly, existing ones improve constantly, and pricing/availability shifts. A runtime designed for 20+ years cannot be coupled to any single provider.

Additionally, many providers now implement the OpenAI chat completions API format, making it possible to support many through a single adapter pattern.

## Decision

Nexus uses a three-tier provider architecture:

1. **ModelProvider interface** — The abstract contract all providers implement
2. **Native providers** — First-class implementations for major providers (OpenAI, Anthropic, Gemini, Ollama)
3. **OpenAICompatibleProvider** — A generic adapter that works with any provider implementing the OpenAI API format (DeepSeek, Groq, Together, Mistral, Perplexity, OpenRouter, Fireworks, LM Studio, vLLM, etc.)

The system auto-detects available providers from environment variables and routes requests through a ModelRouter with fallback support.

## Supported Providers (at launch)

| Provider | Type | Models |
|----------|------|--------|
| OpenAI | Native | GPT-4o, GPT-4o-mini, embeddings |
| Anthropic | Native | Claude 3.5 Sonnet, Opus, Haiku |
| Google Gemini | Native | Gemini 2.0 Flash, 1.5 Pro |
| Ollama | Native | Any local model |
| DeepSeek | Compatible | deepseek-chat, deepseek-coder |
| Groq | Compatible | Llama, Mixtral (ultra-fast) |
| Together AI | Compatible | 100+ open models |
| Mistral AI | Compatible | Mistral Large, embeddings |
| Perplexity | Compatible | Online search-augmented |
| OpenRouter | Compatible | Any model through one API |
| Fireworks | Compatible | Fast open model inference |
| LM Studio | Compatible | Any local model via GUI |

## Key Design Decisions

1. **No provider SDKs** — We use raw `fetch()` to avoid dependency on provider-specific packages that change frequently
2. **Environment variable convention** — `{PROVIDER}_API_KEY` for consistency
3. **`createProvider()` factory** — One-line setup for any supported provider
4. **Presets** — Pre-configured settings (URLs, default models) so developers don't need to look them up
5. **Generic adapter** — Any new provider that implements OpenAI-compatible API works immediately

## Consequences

### Easier
- Supporting new providers (often zero new code needed)
- Switching providers without code changes
- Running locally with Ollama during development
- Using the cheapest/fastest provider per task

### Harder
- Provider-specific features (function calling, vision) need individual handling
- Token counting varies across providers
- Some providers have subtle API differences that need workarounds
