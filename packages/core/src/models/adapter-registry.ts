/**
 * Nexus Adapter Registry
 * 
 * The key to supporting ALL models — current and future.
 * 
 * Instead of writing a new provider class for every AI service,
 * we recognize that most providers use one of ~4 API patterns:
 * 
 * 1. OpenAI format    — /chat/completions (80% of market)
 * 2. Anthropic format — /v1/messages
 * 3. Gemini format    — /models/{model}:generateContent
 * 4. Ollama format    — /api/chat
 * 
 * This registry holds adapters for each pattern and creates
 * provider instances from configuration alone — no new code needed.
 * 
 * Adding a new provider:
 *   Just add it to nexus.config.json with the right adapter type.
 *   The registry handles the rest.
 */

import type { ProviderConfig } from '@nexus/types';
import type { ModelProvider } from './provider.js';
import { OpenAICompatibleProvider } from './openai-compatible-provider.js';
import { AnthropicProvider } from './anthropic-provider.js';
import { GeminiProvider } from './gemini-provider.js';
import { OllamaProvider } from './ollama-provider.js';

/**
 * Creates a ModelProvider instance from a configuration object.
 * This is how providers are created from config files — no code changes needed.
 */
export function createProviderFromConfig(config: ProviderConfig): ModelProvider {
  // Resolve API key from environment or static config
  const apiKey = resolveApiKey(config);

  switch (config.adapter) {
    case 'openai':
      return new OpenAICompatibleProvider({
        id: config.id,
        name: config.name,
        baseUrl: config.baseUrl,
        apiKey,
        defaultModel: config.defaultModel,
        timeoutMs: config.timeoutMs,
        headers: config.headers,
      });

    case 'anthropic':
      return new AnthropicProvider({
        apiKey,
        baseUrl: config.baseUrl,
        defaultModel: config.defaultModel,
        timeoutMs: config.timeoutMs,
      });

    case 'gemini':
      return new GeminiProvider({
        apiKey,
        defaultModel: config.defaultModel,
        timeoutMs: config.timeoutMs,
      });

    case 'ollama':
      return new OllamaProvider({
        baseUrl: config.baseUrl,
        defaultModel: config.defaultModel,
        timeoutMs: config.timeoutMs,
      });

    case 'custom':
      // Custom adapter — treat as OpenAI-compatible by default
      // This works for the vast majority of new providers
      return new OpenAICompatibleProvider({
        id: config.id,
        name: config.name,
        baseUrl: config.baseUrl,
        apiKey,
        defaultModel: config.defaultModel,
        timeoutMs: config.timeoutMs,
        headers: config.headers,
      });

    default:
      throw new Error(
        `Unknown adapter type: "${config.adapter}". ` +
        `Supported: openai, anthropic, gemini, ollama, custom`
      );
  }
}

/**
 * Create multiple providers from an array of configurations.
 * Skips disabled providers and those without valid API keys (unless local).
 */
export function createProvidersFromConfig(configs: ProviderConfig[]): ModelProvider[] {
  const providers: ModelProvider[] = [];

  for (const config of configs) {
    // Skip disabled providers
    if (config.enabled === false) continue;

    try {
      const provider = createProviderFromConfig(config);

      // Only add if available (has API key or is local)
      if (provider.isAvailable()) {
        providers.push(provider);
      }
    } catch (error) {
      // Log but don't crash — a broken provider config shouldn't kill the runtime
      console.warn(
        `[Nexus] Skipping provider "${config.id}": ${(error as Error).message}`
      );
    }
  }

  return providers;
}

/**
 * The catalog of well-known providers.
 * This is a convenience — these can all be configured manually too.
 * 
 * Each entry maps to a ProviderConfig that can be used directly.
 * The only thing the user needs to provide is the API key (via env var).
 */
export const PROVIDER_CATALOG: Record<string, Omit<ProviderConfig, 'apiKey'>> = {
  // === Tier 1: Major cloud providers ===
  openai: {
    id: 'openai',
    name: 'OpenAI',
    adapter: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    apiKeyEnv: 'OPENAI_API_KEY',
    defaultModel: 'gpt-4o',
    capabilities: {
      chat: true, embeddings: true, vision: true, toolCalling: true,
      structuredOutput: true, streaming: true,
      maxContextTokens: 128000, maxOutputTokens: 16384,
    },
  },
  anthropic: {
    id: 'anthropic',
    name: 'Anthropic',
    adapter: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    apiKeyEnv: 'ANTHROPIC_API_KEY',
    defaultModel: 'claude-sonnet-4-20250514',
    capabilities: {
      chat: true, embeddings: false, vision: true, toolCalling: true,
      structuredOutput: true, streaming: true,
      maxContextTokens: 200000, maxOutputTokens: 8192,
    },
  },
  gemini: {
    id: 'gemini',
    name: 'Google Gemini',
    adapter: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    apiKeyEnv: 'GEMINI_API_KEY',
    defaultModel: 'gemini-2.0-flash',
    capabilities: {
      chat: true, embeddings: true, vision: true, audio: true, toolCalling: true,
      structuredOutput: true, streaming: true,
      maxContextTokens: 1000000, maxOutputTokens: 8192,
    },
  },

  // === Tier 2: Fast inference providers ===
  groq: {
    id: 'groq',
    name: 'Groq',
    adapter: 'openai',
    baseUrl: 'https://api.groq.com/openai/v1',
    apiKeyEnv: 'GROQ_API_KEY',
    defaultModel: 'llama-3.1-70b-versatile',
    timeoutMs: 15000,
    capabilities: {
      chat: true, embeddings: false, vision: false, toolCalling: true,
      structuredOutput: true, streaming: true,
      maxContextTokens: 131072, maxOutputTokens: 8192,
    },
  },
  cerebras: {
    id: 'cerebras',
    name: 'Cerebras',
    adapter: 'openai',
    baseUrl: 'https://api.cerebras.ai/v1',
    apiKeyEnv: 'CEREBRAS_API_KEY',
    defaultModel: 'llama3.1-70b',
    timeoutMs: 15000,
    capabilities: {
      chat: true, embeddings: false, vision: false, toolCalling: false,
      structuredOutput: false, streaming: true,
      maxContextTokens: 128000, maxOutputTokens: 8192,
    },
  },
  sambanova: {
    id: 'sambanova',
    name: 'SambaNova',
    adapter: 'openai',
    baseUrl: 'https://api.sambanova.ai/v1',
    apiKeyEnv: 'SAMBANOVA_API_KEY',
    defaultModel: 'Meta-Llama-3.1-70B-Instruct',
    capabilities: {
      chat: true, embeddings: false, vision: false, toolCalling: false,
      structuredOutput: false, streaming: true,
      maxContextTokens: 128000, maxOutputTokens: 4096,
    },
  },

  // === Tier 3: Model labs ===
  deepseek: {
    id: 'deepseek',
    name: 'DeepSeek',
    adapter: 'openai',
    baseUrl: 'https://api.deepseek.com/v1',
    apiKeyEnv: 'DEEPSEEK_API_KEY',
    defaultModel: 'deepseek-chat',
    timeoutMs: 60000,
    capabilities: {
      chat: true, embeddings: false, vision: false, toolCalling: true,
      structuredOutput: true, streaming: true,
      maxContextTokens: 128000, maxOutputTokens: 8192,
    },
  },
  mistral: {
    id: 'mistral',
    name: 'Mistral AI',
    adapter: 'openai',
    baseUrl: 'https://api.mistral.ai/v1',
    apiKeyEnv: 'MISTRAL_API_KEY',
    defaultModel: 'mistral-large-latest',
    capabilities: {
      chat: true, embeddings: true, vision: true, toolCalling: true,
      structuredOutput: true, streaming: true,
      maxContextTokens: 128000, maxOutputTokens: 8192,
    },
  },
  cohere: {
    id: 'cohere',
    name: 'Cohere',
    adapter: 'openai',
    baseUrl: 'https://api.cohere.com/v2',
    apiKeyEnv: 'COHERE_API_KEY',
    defaultModel: 'command-r-plus',
    capabilities: {
      chat: true, embeddings: true, vision: false, toolCalling: true,
      structuredOutput: true, streaming: true,
      maxContextTokens: 128000, maxOutputTokens: 4096,
    },
  },
  xai: {
    id: 'xai',
    name: 'xAI (Grok)',
    adapter: 'openai',
    baseUrl: 'https://api.x.ai/v1',
    apiKeyEnv: 'XAI_API_KEY',
    defaultModel: 'grok-2',
    capabilities: {
      chat: true, embeddings: false, vision: true, toolCalling: true,
      structuredOutput: true, streaming: true,
      maxContextTokens: 131072, maxOutputTokens: 8192,
    },
  },

  // === Tier 4: Aggregators / Routers ===
  together: {
    id: 'together',
    name: 'Together AI',
    adapter: 'openai',
    baseUrl: 'https://api.together.xyz/v1',
    apiKeyEnv: 'TOGETHER_API_KEY',
    defaultModel: 'meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo',
    capabilities: {
      chat: true, embeddings: true, vision: false, toolCalling: true,
      structuredOutput: true, streaming: true,
      maxContextTokens: 131072, maxOutputTokens: 4096,
    },
  },
  openrouter: {
    id: 'openrouter',
    name: 'OpenRouter',
    adapter: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKeyEnv: 'OPENROUTER_API_KEY',
    defaultModel: 'anthropic/claude-sonnet-4',
    timeoutMs: 60000,
    capabilities: {
      chat: true, embeddings: false, vision: true, toolCalling: true,
      structuredOutput: true, streaming: true,
      maxContextTokens: 200000, maxOutputTokens: 8192,
    },
  },
  fireworks: {
    id: 'fireworks',
    name: 'Fireworks AI',
    adapter: 'openai',
    baseUrl: 'https://api.fireworks.ai/inference/v1',
    apiKeyEnv: 'FIREWORKS_API_KEY',
    defaultModel: 'accounts/fireworks/models/llama-v3p1-70b-instruct',
    capabilities: {
      chat: true, embeddings: true, vision: false, toolCalling: true,
      structuredOutput: true, streaming: true,
      maxContextTokens: 131072, maxOutputTokens: 4096,
    },
  },
  perplexity: {
    id: 'perplexity',
    name: 'Perplexity',
    adapter: 'openai',
    baseUrl: 'https://api.perplexity.ai',
    apiKeyEnv: 'PERPLEXITY_API_KEY',
    defaultModel: 'llama-3.1-sonar-large-128k-online',
    capabilities: {
      chat: true, embeddings: false, vision: false, toolCalling: false,
      structuredOutput: false, streaming: true,
      maxContextTokens: 128000, maxOutputTokens: 4096,
    },
  },

  // === Tier 5: Cloud platform AI services ===
  azure_openai: {
    id: 'azure_openai',
    name: 'Azure OpenAI',
    adapter: 'openai',
    baseUrl: 'https://{resource}.openai.azure.com/openai/deployments/{deployment}',
    apiKeyEnv: 'AZURE_OPENAI_API_KEY',
    defaultModel: 'gpt-4o',
    headers: { 'api-key': '{AZURE_OPENAI_API_KEY}' },
    capabilities: {
      chat: true, embeddings: true, vision: true, toolCalling: true,
      structuredOutput: true, streaming: true,
      maxContextTokens: 128000, maxOutputTokens: 16384,
    },
  },
  bedrock: {
    id: 'bedrock',
    name: 'AWS Bedrock',
    adapter: 'openai',
    baseUrl: 'https://bedrock-runtime.{region}.amazonaws.com',
    apiKeyEnv: 'AWS_ACCESS_KEY_ID',
    defaultModel: 'anthropic.claude-sonnet-4-20250514-v1:0',
    capabilities: {
      chat: true, embeddings: true, vision: true, toolCalling: true,
      structuredOutput: true, streaming: true,
      maxContextTokens: 200000, maxOutputTokens: 8192,
    },
  },

  // === Tier 6: Local / Self-hosted ===
  ollama: {
    id: 'ollama',
    name: 'Ollama (Local)',
    adapter: 'ollama',
    baseUrl: 'http://localhost:11434',
    defaultModel: 'llama3.1',
    timeoutMs: 120000,
    capabilities: {
      chat: true, embeddings: true, vision: false, toolCalling: false,
      structuredOutput: false, streaming: true,
      maxContextTokens: 128000, maxOutputTokens: 4096,
    },
  },
  lmstudio: {
    id: 'lmstudio',
    name: 'LM Studio (Local)',
    adapter: 'openai',
    baseUrl: 'http://localhost:1234/v1',
    defaultModel: 'local-model',
    timeoutMs: 120000,
    capabilities: {
      chat: true, embeddings: true, vision: false, toolCalling: false,
      structuredOutput: false, streaming: true,
      maxContextTokens: 32000, maxOutputTokens: 4096,
    },
  },
  vllm: {
    id: 'vllm',
    name: 'vLLM (Self-hosted)',
    adapter: 'openai',
    baseUrl: 'http://localhost:8000/v1',
    defaultModel: 'local-model',
    timeoutMs: 60000,
    capabilities: {
      chat: true, embeddings: false, vision: false, toolCalling: false,
      structuredOutput: false, streaming: true,
      maxContextTokens: 32000, maxOutputTokens: 4096,
    },
  },
  llamacpp: {
    id: 'llamacpp',
    name: 'llama.cpp Server',
    adapter: 'openai',
    baseUrl: 'http://localhost:8080/v1',
    defaultModel: 'local-model',
    timeoutMs: 120000,
    capabilities: {
      chat: true, embeddings: true, vision: false, toolCalling: false,
      structuredOutput: false, streaming: true,
      maxContextTokens: 32000, maxOutputTokens: 4096,
    },
  },
};

/**
 * Resolve API key from environment variable or static config
 */
function resolveApiKey(config: ProviderConfig): string {
  // Static key takes priority (for testing/dev)
  if (config.apiKey) return config.apiKey;

  // Resolve from environment variable
  if (config.apiKeyEnv) {
    return process.env[config.apiKeyEnv] || '';
  }

  // Local providers don't need keys
  return '';
}

/**
 * Auto-detect all available providers from environment variables.
 * Scans the catalog and creates providers for any that have valid API keys.
 */
export function detectProvidersFromCatalog(): ModelProvider[] {
  const providers: ModelProvider[] = [];

  for (const [id, catalogEntry] of Object.entries(PROVIDER_CATALOG)) {
    const config: ProviderConfig = { ...catalogEntry, id };

    // Skip local providers in auto-detect (need explicit opt-in)
    if (['ollama', 'lmstudio', 'vllm', 'llamacpp'].includes(id)) continue;

    // Skip providers that need special URL configuration
    if (['azure_openai', 'bedrock'].includes(id)) continue;

    // Check if API key is available
    if (config.apiKeyEnv && process.env[config.apiKeyEnv]) {
      try {
        const provider = createProviderFromConfig(config);
        if (provider.isAvailable()) {
          providers.push(provider);
        }
      } catch {
        // Skip failures silently
      }
    }
  }

  return providers;
}
