/**
 * Kernova Adapter Registry
 *
 * The key to supporting ALL models — current and future.
 *
 * Instead of writing a new provider class for every AI service,
 * we recognize that most providers use one of a few API patterns:
 *
 * 1. OpenAI format    — /chat/completions (most of the market, including Azure OpenAI)
 * 2. Anthropic format — /v1/messages
 * 3. Gemini format    — /models/{model}:generateContent (also Vertex AI)
 * 4. Bedrock Converse — /model/{model}/converse (every model on AWS Bedrock)
 * 5. Ollama format    — /api/chat
 *
 * This registry holds adapters for each pattern and creates
 * provider instances from configuration alone — no new code needed.
 *
 * Adding a new provider:
 *   Just add it to kernova.config.json with the right adapter type.
 *   The registry handles the rest.
 */

import type { ProviderConfig, ReasoningEffort } from '@kernova/types';
import type { ModelProvider } from './provider.js';
import { OpenAICompatibleProvider, type OpenAICompatibleConfig, type ReasoningFormat } from './openai-compatible-provider.js';
import { OpenAIProvider } from './openai-provider.js';
import { AzureOpenAIProvider } from './azure-provider.js';
import { AnthropicProvider } from './anthropic-provider.js';
import { GeminiProvider } from './gemini-provider.js';
import { VertexAIProvider, VERTEX_DEFAULT_MODEL } from './vertex-provider.js';
import { BedrockProvider, BEDROCK_DEFAULT_MODEL } from './bedrock-provider.js';
import { OllamaProvider } from './ollama-provider.js';

/** Other names for catalog providers */
export const PROVIDER_ALIASES: Record<string, string> = {
  google: 'gemini',
  azure_openai: 'azure',
  'azure-openai': 'azure',
  'vertex-ai': 'vertex',
  'aws-bedrock': 'bedrock',
  dashscope: 'qwen',
  kimi: 'moonshot',
  glm: 'zai',
};

/** The catalog ID for a provider name or alias */
export function resolveProviderAlias(name: string): string {
  return PROVIDER_ALIASES[name] ?? name;
}

/** Reads an adapter option of the given type, or undefined */
function option<T extends 'string' | 'boolean' | 'number' | 'object'>(
  config: ProviderConfig,
  key: string,
  type: T,
): (T extends 'string' ? string : T extends 'boolean' ? boolean : T extends 'number' ? number : Record<string, unknown>) | undefined {
  const value = config.options?.[key];
  return typeof value === type && value !== null && !Array.isArray(value) ? value as never : undefined;
}

/** Reads an adapter option that's a list of strings, or undefined */
function listOption(config: ProviderConfig, key: string): string[] | undefined {
  const value = config.options?.[key];
  return Array.isArray(value) && value.every(v => typeof v === 'string') ? value : undefined;
}

/**
 * Creates a ModelProvider instance from a configuration object.
 * This is how providers are created from config files — no code changes needed.
 */
export function createProviderFromConfig(config: ProviderConfig): ModelProvider {
  // Resolve API key from environment or static config
  const apiKey = resolveApiKey(config);
  // Providers configured without any key source (local servers) don't need one
  const requiresApiKey = Boolean(config.apiKeyEnv || config.apiKey);

  // The catalog's own baseUrl and defaultModel are left out for providers that read environment
  // overrides (OPENAI_BASE_URL, OPENAI_MODEL, ANTHROPIC_BASE_URL, OLLAMA_HOST), so those still apply
  const catalogEntry = PROVIDER_CATALOG[config.id];
  const ownBaseUrl = config.baseUrl && config.baseUrl !== catalogEntry?.baseUrl ? config.baseUrl : undefined;
  const ownDefaultModel = config.defaultModel && config.defaultModel !== catalogEntry?.defaultModel ? config.defaultModel : undefined;

  const compatible = () => new OpenAICompatibleProvider({
    id: config.id,
    name: config.name,
    baseUrl: config.baseUrl,
    apiKey,
    requiresApiKey,
    defaultModel: config.defaultModel,
    timeoutMs: config.timeoutMs,
    headers: config.headers,
    supportsEmbeddings: config.capabilities?.embeddings,
    embeddingModel: option(config, 'embeddingModel', 'string'),
    reasoningFormat: option(config, 'reasoningFormat', 'string') as ReasoningFormat | undefined,
    replayReasoning: option(config, 'replayReasoning', 'boolean'),
    streamUsage: option(config, 'streamUsage', 'boolean'),
    reasoningEfforts: listOption(config, 'reasoningEfforts') as ReasoningEffort[] | undefined,
    omitTemperature: option(config, 'omitTemperature', 'boolean'),
    maxTokensField: option(config, 'maxTokensField', 'string') as OpenAICompatibleConfig['maxTokensField'],
    defaultMaxTokens: option(config, 'defaultMaxTokens', 'number'),
  });

  switch (config.adapter) {
    case 'openai':
      if (config.id === 'openai') {
        return new OpenAIProvider({
          apiKey,
          baseUrl: ownBaseUrl,
          defaultModel: ownDefaultModel,
          timeoutMs: config.timeoutMs,
          embeddingModel: option(config, 'embeddingModel', 'string'),
          organization: option(config, 'organization', 'string'),
          project: option(config, 'project', 'string'),
        });
      }
      return compatible();

    case 'azure':
      return new AzureOpenAIProvider({
        endpoint: option(config, 'endpoint', 'string') ?? (config.baseUrl || undefined),
        apiKey: apiKey || undefined,
        defaultModel: config.defaultModel,
        embeddingModel: option(config, 'embeddingModel', 'string'),
        apiVersion: option(config, 'apiVersion', 'string'),
        tenantId: option(config, 'tenantId', 'string'),
        clientId: option(config, 'clientId', 'string'),
        managedIdentity: option(config, 'managedIdentity', 'boolean'),
        timeoutMs: config.timeoutMs,
      });

    case 'anthropic':
      return new AnthropicProvider({
        apiKey,
        baseUrl: ownBaseUrl,
        defaultModel: config.defaultModel,
        timeoutMs: config.timeoutMs,
      });

    case 'gemini':
      return new GeminiProvider({
        apiKey,
        defaultModel: config.defaultModel,
        embeddingModel: option(config, 'embeddingModel', 'string'),
        timeoutMs: config.timeoutMs,
      });

    case 'vertex':
      return new VertexAIProvider({
        project: option(config, 'project', 'string'),
        location: option(config, 'location', 'string'),
        keyFile: option(config, 'keyFile', 'string'),
        apiKey: apiKey || undefined,
        baseUrl: config.baseUrl || undefined,
        defaultModel: config.defaultModel,
        embeddingModel: option(config, 'embeddingModel', 'string'),
        timeoutMs: config.timeoutMs,
      });

    case 'bedrock':
      return new BedrockProvider({
        region: option(config, 'region', 'string'),
        profile: option(config, 'profile', 'string'),
        apiKey: apiKey || undefined,
        instanceMetadata: option(config, 'instanceMetadata', 'boolean'),
        baseUrl: config.baseUrl || undefined,
        defaultModel: config.defaultModel,
        embeddingModel: option(config, 'embeddingModel', 'string'),
        additionalModelRequestFields: option(config, 'additionalModelRequestFields', 'object'),
        timeoutMs: config.timeoutMs,
      });

    case 'ollama':
      return new OllamaProvider({
        baseUrl: ownBaseUrl,
        defaultModel: config.defaultModel,
        embeddingModel: option(config, 'embeddingModel', 'string'),
        timeoutMs: config.timeoutMs,
      });

    case 'custom':
      // Custom adapter — treat as OpenAI-compatible by default
      // This works for the vast majority of new providers
      return compatible();

    default:
      throw new Error(
        `Unknown adapter type: "${config.adapter}". ` +
        `Supported: openai, anthropic, gemini, azure, bedrock, vertex, ollama, custom`
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
        `[Kernova] Skipping provider "${config.id}": ${(error as Error).message}`
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
      chat: true, embeddings: true, vision: true, audio: true, files: true, toolCalling: true,
      structuredOutput: true, streaming: true, reasoning: true, promptCaching: true,
      maxContextTokens: 128000, maxOutputTokens: 16384,
    },
  },
  anthropic: {
    id: 'anthropic',
    name: 'Anthropic',
    adapter: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    apiKeyEnv: 'ANTHROPIC_API_KEY',
    defaultModel: 'claude-sonnet-5-5',
    capabilities: {
      chat: true, embeddings: false, vision: true, files: true, toolCalling: true,
      structuredOutput: true, streaming: true, reasoning: true, promptCaching: true,
      maxContextTokens: 200000, maxOutputTokens: 64000,
    },
  },
  gemini: {
    id: 'gemini',
    name: 'Google Gemini',
    adapter: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    apiKeyEnv: 'GEMINI_API_KEY',
    defaultModel: 'gemini-flash-latest',
    capabilities: {
      chat: true, embeddings: true, vision: true, audio: true, files: true, toolCalling: true,
      structuredOutput: true, streaming: true, reasoning: true, promptCaching: true,
      maxContextTokens: 1000000, maxOutputTokens: 65536,
    },
  },

  // === Tier 2: Fast inference providers ===
  groq: {
    id: 'groq',
    name: 'Groq',
    adapter: 'openai',
    baseUrl: 'https://api.groq.com/openai/v1',
    apiKeyEnv: 'GROQ_API_KEY',
    defaultModel: 'openai/gpt-oss-120b',
    timeoutMs: 15000,
    capabilities: {
      chat: true, embeddings: false, vision: false, toolCalling: true,
      structuredOutput: true, streaming: true, reasoning: true,
      maxContextTokens: 131072, maxOutputTokens: 8192,
    },
  },
  cerebras: {
    id: 'cerebras',
    name: 'Cerebras',
    adapter: 'openai',
    baseUrl: 'https://api.cerebras.ai/v1',
    apiKeyEnv: 'CEREBRAS_API_KEY',
    defaultModel: 'gpt-oss-120b',
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
    defaultModel: 'Meta-Llama-3.3-70B-Instruct',
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
    // Thinking is chosen by model (deepseek-reasoner); its reasoning goes back during tool use
    options: { reasoningFormat: 'none', replayReasoning: true, streamUsage: true },
    capabilities: {
      chat: true, embeddings: false, vision: false, toolCalling: true,
      structuredOutput: true, streaming: true, reasoning: true, promptCaching: true,
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
    options: { embeddingModel: 'mistral-embed', reasoningFormat: 'none' },
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
    baseUrl: 'https://api.cohere.ai/compatibility/v1',
    apiKeyEnv: 'COHERE_API_KEY',
    defaultModel: 'command-a-03-2025',
    options: { embeddingModel: 'embed-v4.0' },
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
    defaultModel: 'grok-4-latest',
    options: { streamUsage: true },
    capabilities: {
      chat: true, embeddings: false, vision: true, toolCalling: true,
      structuredOutput: true, streaming: true, reasoning: true, promptCaching: true,
      maxContextTokens: 131072, maxOutputTokens: 8192,
    },
  },
  qwen: {
    id: 'qwen',
    name: 'Qwen (Alibaba Cloud Model Studio)',
    adapter: 'openai',
    baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
    apiKeyEnv: 'DASHSCOPE_API_KEY',
    defaultModel: 'qwen-plus',
    options: { reasoningFormat: 'qwen', streamUsage: true },
    capabilities: {
      chat: true, embeddings: false, vision: true, toolCalling: true,
      structuredOutput: true, streaming: true, reasoning: true,
      maxContextTokens: 131072, maxOutputTokens: 8192,
    },
  },
  moonshot: {
    id: 'moonshot',
    name: 'Moonshot AI (Kimi)',
    adapter: 'openai',
    baseUrl: 'https://api.moonshot.ai/v1',
    apiKeyEnv: 'MOONSHOT_API_KEY',
    defaultModel: 'kimi-k3.1-pro',
    timeoutMs: 120000,
    // Kimi K3 models always think and have fixed sampling (no temperature); their reasoning goes
    // back with tool calls, and reasoning_effort takes low, high, or max
    options: {
      reasoningFormat: 'reasoning_effort',
      reasoningEfforts: ['low', 'high', 'max'],
      replayReasoning: true,
      omitTemperature: true,
      maxTokensField: 'max_completion_tokens',
      defaultMaxTokens: 16384,
      streamUsage: true,
    },
    capabilities: {
      chat: true, embeddings: false, vision: true, toolCalling: true,
      structuredOutput: true, streaming: true, reasoning: true,
      maxContextTokens: 1000000, maxOutputTokens: 131072,
    },
  },
  zai: {
    id: 'zai',
    name: 'Z.ai (GLM)',
    adapter: 'openai',
    baseUrl: 'https://api.z.ai/api/paas/v4',
    apiKeyEnv: 'ZAI_API_KEY',
    defaultModel: 'glm-5.3',
    timeoutMs: 120000,
    // GLM-5.3 always thinks; earlier models can turn it off. Reasoning goes back with tool calls
    options: { reasoningFormat: 'zai', replayReasoning: true, defaultMaxTokens: 16384 },
    capabilities: {
      chat: true, embeddings: false, vision: false, toolCalling: true,
      structuredOutput: true, streaming: true, reasoning: true,
      maxContextTokens: 200000, maxOutputTokens: 131072,
    },
  },

  // === Tier 4: Aggregators / Routers ===
  together: {
    id: 'together',
    name: 'Together AI',
    adapter: 'openai',
    baseUrl: 'https://api.together.xyz/v1',
    apiKeyEnv: 'TOGETHER_API_KEY',
    defaultModel: 'openai/gpt-oss-120b',
    options: { streamUsage: true },
    capabilities: {
      chat: true, embeddings: true, vision: false, toolCalling: true,
      structuredOutput: true, streaming: true, reasoning: true,
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
    options: { reasoningFormat: 'openrouter', streamUsage: true },
    capabilities: {
      chat: true, embeddings: false, vision: true, files: true, toolCalling: true,
      structuredOutput: true, streaming: true, reasoning: true,
      maxContextTokens: 200000, maxOutputTokens: 8192,
    },
  },
  fireworks: {
    id: 'fireworks',
    name: 'Fireworks AI',
    adapter: 'openai',
    baseUrl: 'https://api.fireworks.ai/inference/v1',
    apiKeyEnv: 'FIREWORKS_API_KEY',
    defaultModel: 'accounts/fireworks/models/gpt-oss-120b',
    options: { streamUsage: true },
    capabilities: {
      chat: true, embeddings: true, vision: false, toolCalling: true,
      structuredOutput: true, streaming: true, reasoning: true,
      maxContextTokens: 131072, maxOutputTokens: 4096,
    },
  },
  huggingface: {
    id: 'huggingface',
    name: 'Hugging Face Inference Providers',
    adapter: 'openai',
    baseUrl: 'https://router.huggingface.co/v1',
    apiKeyEnv: 'HF_TOKEN',
    defaultModel: 'openai/gpt-oss-120b',
    timeoutMs: 60000,
    capabilities: {
      chat: true, embeddings: false, vision: true, toolCalling: true,
      structuredOutput: true, streaming: true, reasoning: true,
      maxContextTokens: 131072, maxOutputTokens: 8192,
    },
  },
  nvidia: {
    id: 'nvidia',
    name: 'NVIDIA NIM',
    adapter: 'openai',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    apiKeyEnv: 'NVIDIA_API_KEY',
    defaultModel: 'meta/llama-3.3-70b-instruct',
    timeoutMs: 60000,
    capabilities: {
      chat: true, embeddings: false, vision: false, toolCalling: true,
      structuredOutput: true, streaming: true,
      maxContextTokens: 128000, maxOutputTokens: 4096,
    },
  },
  perplexity: {
    id: 'perplexity',
    name: 'Perplexity',
    adapter: 'openai',
    baseUrl: 'https://api.perplexity.ai',
    apiKeyEnv: 'PERPLEXITY_API_KEY',
    defaultModel: 'sonar',
    capabilities: {
      chat: true, embeddings: false, vision: false, toolCalling: false,
      structuredOutput: false, streaming: true,
      maxContextTokens: 128000, maxOutputTokens: 4096,
    },
  },

  // === Tier 5: Cloud platform AI services ===
  azure: {
    id: 'azure',
    name: 'Azure OpenAI',
    adapter: 'azure',
    // The endpoint comes from AZURE_OPENAI_ENDPOINT (or options.endpoint / baseUrl)
    baseUrl: '',
    apiKeyEnv: 'AZURE_OPENAI_API_KEY',
    defaultModel: 'gpt-4o',
    capabilities: {
      chat: true, embeddings: true, vision: true, audio: true, files: true, toolCalling: true,
      structuredOutput: true, streaming: true, reasoning: true, promptCaching: true,
      maxContextTokens: 128000, maxOutputTokens: 16384,
    },
  },
  bedrock: {
    id: 'bedrock',
    name: 'AWS Bedrock',
    adapter: 'bedrock',
    // The endpoint comes from the region (AWS_REGION or options.region)
    baseUrl: '',
    apiKeyEnv: 'AWS_BEARER_TOKEN_BEDROCK',
    defaultModel: BEDROCK_DEFAULT_MODEL,
    capabilities: {
      chat: true, embeddings: true, vision: true, files: true, toolCalling: true,
      structuredOutput: true, streaming: true, reasoning: true, promptCaching: true,
      maxContextTokens: 200000, maxOutputTokens: 64000,
    },
  },
  vertex: {
    id: 'vertex',
    name: 'Google Vertex AI',
    adapter: 'vertex',
    // The endpoint comes from the location (GOOGLE_CLOUD_LOCATION or options.location)
    baseUrl: '',
    defaultModel: VERTEX_DEFAULT_MODEL,
    capabilities: {
      chat: true, embeddings: true, vision: true, audio: true, files: true, toolCalling: true,
      structuredOutput: true, streaming: true, reasoning: true, promptCaching: true,
      maxContextTokens: 1000000, maxOutputTokens: 65536,
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
      chat: true, embeddings: true, vision: true, toolCalling: true,
      structuredOutput: true, streaming: true, reasoning: true,
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

/** Providers detected from the environment by something other than their API key variable */
const LOCAL_PROVIDERS = new Set(['ollama', 'lmstudio', 'vllm', 'llamacpp']);

/**
 * Whether the environment sets a provider up, for providers that need more than an API key:
 * - Azure OpenAI: AZURE_OPENAI_ENDPOINT plus a key or Entra ID app credentials
 * - Bedrock: a Bedrock API key (other AWS credentials are often present for other reasons,
 *   so Bedrock with them is opt-in: configure the provider)
 * - Vertex AI: GOOGLE_GENAI_USE_VERTEXAI=true plus Google Cloud credentials and a project
 */
function configuredByEnvironment(id: string, entry: Omit<ProviderConfig, 'apiKey'>): boolean {
  const env = process.env;
  switch (id) {
    case 'azure':
      return Boolean(env.AZURE_OPENAI_ENDPOINT
        && (env.AZURE_OPENAI_API_KEY || (env.AZURE_TENANT_ID && env.AZURE_CLIENT_ID && env.AZURE_CLIENT_SECRET)));
    case 'vertex':
      return /^(true|1)$/i.test(env.GOOGLE_GENAI_USE_VERTEXAI ?? '');
    default:
      return Boolean(entry.apiKeyEnv && env[entry.apiKeyEnv]);
  }
}

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
 * Scans the catalog and creates providers for any that are set up.
 */
export function detectProvidersFromCatalog(): ModelProvider[] {
  const providers: ModelProvider[] = [];

  for (const [id, catalogEntry] of Object.entries(PROVIDER_CATALOG)) {
    // Skip local providers in auto-detect (need explicit opt-in)
    if (LOCAL_PROVIDERS.has(id)) continue;
    if (!configuredByEnvironment(id, catalogEntry)) continue;

    try {
      const provider = createProviderFromConfig({ ...catalogEntry, id });
      if (provider.isAvailable()) {
        providers.push(provider);
      }
    } catch {
      // Skip failures silently
    }
  }

  return providers;
}
