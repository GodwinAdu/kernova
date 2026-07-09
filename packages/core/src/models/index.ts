/**
 * Kernova Model System
 * 
 * Universal Model Protocol — supports ANY AI model, current or future.
 * 
 * Architecture:
 *   Protocol Layer   → Universal interface (ModelProvider)
 *   Adapter Layer    → Pattern-based adapters (OpenAI, Anthropic, Gemini, Ollama)
 *   Discovery Layer  → Config-driven provider registration
 * 
 * Adding a new provider:
 *   Option A: Add to kernova.config.json with adapter type → zero code
 *   Option B: Use createProvider('name') for cataloged providers → one line
 *   Option C: New OpenAICompatibleProvider({...}) for custom → minimal code
 * 
 * Currently cataloged (20+ providers):
 *   Cloud: OpenAI, Anthropic, Gemini, DeepSeek, Mistral, Cohere, xAI/Grok
 *   Fast: Groq, Cerebras, SambaNova, Fireworks
 *   Routers: OpenRouter, Together AI, Perplexity
 *   Platform: Azure OpenAI, AWS Bedrock
 *   Local: Ollama, LM Studio, vLLM, llama.cpp
 */

// Core interface
export type { ModelProvider, ProviderRegistration } from './provider.js';

// Adapter registry (config-driven provider creation)
export {
  createProviderFromConfig,
  createProvidersFromConfig,
  detectProvidersFromCatalog,
  PROVIDER_CATALOG,
} from './adapter-registry.js';

// Individual adapters (for direct use)
export { OpenAIProvider } from './openai-provider.js';
export type { OpenAIConfig } from './openai-provider.js';
export { AnthropicProvider } from './anthropic-provider.js';
export type { AnthropicConfig } from './anthropic-provider.js';
export { GeminiProvider } from './gemini-provider.js';
export type { GeminiConfig } from './gemini-provider.js';
export { OllamaProvider } from './ollama-provider.js';
export type { OllamaConfig } from './ollama-provider.js';
export { OpenAICompatibleProvider } from './openai-compatible-provider.js';
export type { OpenAICompatibleConfig } from './openai-compatible-provider.js';

// Router
export { ModelRouter } from './model-router.js';
export type { ModelRouterConfig } from './model-router.js';

// Convenience functions
export {
  createProvider,
  detectAvailableProviders,
  getEnvKeyForProvider,
  listPresets,
} from './presets.js';
export type { ProviderPreset } from './presets.js';
