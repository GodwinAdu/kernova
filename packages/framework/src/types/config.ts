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
    provider?: 'local' | 'cloud';
    embeddingModel?: string;
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
