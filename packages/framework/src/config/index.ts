/**
 * defineConfig — Project configuration.
 *
 * Usage:
 *   // kernova.config.ts
 *   import { defineConfig } from '@kernova/framework/config';
 *
 *   export default defineConfig({
 *     name: 'my-support-app',
 *     model: {
 *       provider: 'openai',
 *       model: 'gpt-4o',
 *     },
 *     memory: {
 *       provider: 'cloud',
 *       embeddingModel: 'text-embedding-3-small',
 *     },
 *     gateway: {
 *       openaiCompat: true,
 *       cors: ['https://myapp.com'],
 *       rateLimit: { requests: 100, window: '1m' },
 *     },
 *     deploy: {
 *       region: 'us-east-1',
 *       scale: { minInstances: 1, maxInstances: 10 },
 *     },
 *     app: {
 *       framework: 'next',
 *       port: 3000,
 *     },
 *   });
 */

import type { KernovaFrameworkConfig } from '../types/config.js';

/**
 * Define the project configuration.
 * This is the root config file that ties everything together.
 */
export function defineConfig(config: KernovaFrameworkConfig): KernovaFrameworkConfig {
  if (!config.name) {
    throw new Error('defineConfig: "name" is required');
  }

  // No default `model`: without one, the kernel uses the first provider it finds an API key for
  return {
    version: '0.1.0',
    memory: {
      provider: 'local',
    },
    gateway: {
      openaiCompat: true,
      cors: ['*'],
    },
    app: {
      framework: 'next',
      port: 3000,
    },
    ...config,
  };
}
