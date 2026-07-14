/**
 * Framework configuration types.
 */

export interface ModelConfig {
  /** Model provider (openai, anthropic, etc.) */
  provider: string;
  /** Model identifier */
  model: string;
  /** API key env variable name */
  apiKeyEnv?: string;
  /** Base URL override */
  baseUrl?: string;
}

export interface DeployConfig {
  /** Project region */
  region?: string;
  /** Custom domain */
  domain?: string;
  /** Environment variables to include */
  env?: Record<string, string>;
  /** Scale config */
  scale?: {
    minInstances?: number;
    maxInstances?: number;
    concurrency?: number;
  };
}

export interface KernovaFrameworkConfig {
  /** Project name */
  name: string;
  /** Project version */
  version?: string;
  /** Default model configuration */
  model?: ModelConfig;
  /** Additional model configurations by name */
  models?: Record<string, ModelConfig>;
  /** Memory defaults */
  memory?: {
    /** Provider type: 'sqlite' (default), 'postgres', 'memory', 'redis', 'pinecone', 'custom' */
    provider?: 'sqlite' | 'postgres' | 'memory' | 'redis' | 'pinecone' | 'supabase' | 'custom' | 'local' | 'cloud';
    /** Connection URL (for postgres, redis, supabase) */
    url?: string;
    /** API key (for pinecone, external providers) */
    apiKey?: string;
    /** Embedding model for vector search */
    embeddingModel?: string;
    /** Table/collection name (default: 'memories') */
    table?: string;
    /** Custom adapter path or import */
    adapter?: string;
    /** Enable vector search (requires embedding model + supported provider) */
    vectorSearch?: boolean;
    /** Auto-recall memories and inject into prompt (default: true) */
    autoRecall?: boolean;
    /** Auto-save personal info to memory (default: false — opt-in) */
    autoSave?: boolean;
    /** Number of conversation messages to include as context (default: 20, 0 = none) */
    contextMessages?: number;
    /** Additional provider-specific options */
    options?: Record<string, unknown>;
  };
  /** Deploy configuration */
  deploy?: DeployConfig;
  /** Gateway configuration */
  gateway?: {
    /** Enable OpenAI-compatible endpoint */
    openaiCompat?: boolean;
    /** CORS origins */
    cors?: string[];
    /** Rate limiting */
    rateLimit?: {
      requests: number;
      window: string;
    };
  };
  /** Plugins to load */
  plugins?: string[];
  /** Frontend framework config */
  app?: {
    /** Framework: 'next' | 'react' | 'none' */
    framework?: 'next' | 'react' | 'none';
    /** Port for dev server */
    port?: number;
  };
}
