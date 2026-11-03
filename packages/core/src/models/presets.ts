/**
 * Provider Presets (Convenience Layer)
 * 
 * Re-exports from the adapter registry for backward compatibility
 * and developer convenience.
 * 
 * Usage:
 *   import { createProvider, listPresets } from '@kernova/core';
 *   const deepseek = createProvider('deepseek');
 */

import type { ProviderConfig } from '@kernova/types';
import type { ModelProvider } from './provider.js';
import {
  createProviderFromConfig,
  PROVIDER_CATALOG,
  detectProvidersFromCatalog,
  resolveProviderAlias,
} from './adapter-registry.js';

/**
 * Known provider presets — any string in the catalog
 */
export type ProviderPreset = keyof typeof PROVIDER_CATALOG | string;

/**
 * Create a provider from a preset name or custom config.
 * Automatically reads the API key from the corresponding environment variable.
 * 
 * @param presetOrConfig - Provider preset name or full ProviderConfig
 * @param overrides - Optional configuration overrides
 */
export function createProvider(
  presetOrConfig: ProviderPreset | ProviderConfig,
  overrides: Partial<ProviderConfig> = {},
): ModelProvider {
  let config: ProviderConfig;

  if (typeof presetOrConfig === 'string') {
    const id = resolveProviderAlias(presetOrConfig);
    const catalogEntry = PROVIDER_CATALOG[id];
    if (!catalogEntry) {
      throw new Error(
        `Unknown provider: "${presetOrConfig}". ` +
        `Available: ${Object.keys(PROVIDER_CATALOG).join(', ')}. ` +
        `Or pass a full ProviderConfig object for custom providers.`
      );
    }
    config = {
      ...catalogEntry,
      id,
      ...overrides,
      // Adapter options add to the catalog's (e.g. a region on top of the reasoning format)
      ...((catalogEntry.options || overrides.options) && { options: { ...catalogEntry.options, ...overrides.options } }),
    };
  } else {
    config = { ...presetOrConfig, ...overrides };
  }

  return createProviderFromConfig(config);
}

/**
 * Auto-detect all available providers from environment variables.
 */
export function detectAvailableProviders(): ModelProvider[] {
  return detectProvidersFromCatalog();
}

/**
 * Get the environment variable name for a provider
 */
export function getEnvKeyForProvider(preset: string): string | undefined {
  const entry = PROVIDER_CATALOG[resolveProviderAlias(preset)];
  return entry?.apiKeyEnv;
}

/**
 * List all available presets with their details
 */
export function listPresets(): Array<{
  id: string;
  name: string;
  envKey: string;
  defaultModel: string;
  adapter: string;
  local: boolean;
}> {
  return Object.entries(PROVIDER_CATALOG).map(([id, config]) => ({
    id,
    name: config.name,
    envKey: config.apiKeyEnv || '',
    defaultModel: config.defaultModel,
    adapter: config.adapter,
    local: config.baseUrl.includes('localhost'),
  }));
}
