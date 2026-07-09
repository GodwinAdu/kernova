/**
 * Multi-Provider Example
 * 
 * Demonstrates how to use different AI providers with Nexus.
 * Nexus supports 10+ providers out of the box.
 * 
 * Supported:
 *   - OpenAI       (OPENAI_API_KEY)
 *   - Anthropic    (ANTHROPIC_API_KEY)
 *   - Google Gemini (GEMINI_API_KEY)
 *   - DeepSeek     (DEEPSEEK_API_KEY)
 *   - Groq         (GROQ_API_KEY)
 *   - Together AI  (TOGETHER_API_KEY)
 *   - Mistral AI   (MISTRAL_API_KEY)
 *   - Perplexity   (PERPLEXITY_API_KEY)
 *   - OpenRouter   (OPENROUTER_API_KEY)
 *   - Fireworks    (FIREWORKS_API_KEY)
 *   - Ollama       (local, no key needed)
 *   - LM Studio    (local, no key needed)
 *   - Any OpenAI-compatible API
 * 
 * Run:
 *   npx tsx examples/multi-provider.ts
 */

import {
  NexusKernel,
  defineAgent,
  createProvider,
  listPresets,
  OpenAICompatibleProvider,
} from '@nexus/core';

async function main() {
  console.log('');
  console.log('Nexus — Supported Providers');
  console.log('═══════════════════════════════════════════');
  console.log('');

  // List all available presets
  const presets = listPresets();
  for (const preset of presets) {
    const keyStatus = preset.local
      ? '(local, no key needed)'
      : preset.envKey
        ? process.env[preset.envKey] ? '✓ configured' : `✗ set ${preset.envKey}`
        : '';
    console.log(`  ${preset.id.padEnd(14)} ${preset.name.padEnd(20)} ${keyStatus}`);
  }

  console.log('');
  console.log('─────────────────────────────────────────────');
  console.log('');

  // === Method 1: Auto-detect (kernel does this automatically) ===
  const kernel = new NexusKernel({
    environment: 'development',
    debug: true,
  });

  console.log('Auto-detected providers:', kernel.getStatus().availableProviders);
  console.log('');

  // === Method 2: Explicit provider creation ===
  // Use createProvider() for any supported provider:
  //
  //   const deepseek = createProvider('deepseek');
  //   const groq = createProvider('groq');
  //   const gemini = createProvider('gemini');
  //   const ollama = createProvider('ollama', { defaultModel: 'llama3.1' });

  // === Method 3: Custom OpenAI-compatible endpoint ===
  // Any server that implements /chat/completions works:
  //
  //   const custom = new OpenAICompatibleProvider({
  //     id: 'my-server',
  //     name: 'My Private LLM',
  //     baseUrl: 'https://my-server.com/v1',
  //     apiKey: 'my-key',
  //     defaultModel: 'my-model',
  //   });

  // === Method 4: Specify providers in kernel config ===
  //
  //   const kernel = new NexusKernel({
  //     environment: 'development',
  //     providers: [
  //       createProvider('deepseek'),
  //       createProvider('groq'),
  //     ],
  //     models: {
  //       default: { provider: 'deepseek', model: 'deepseek-chat' },
  //       fallback: { provider: 'groq', model: 'llama-3.1-70b-versatile' },
  //     },
  //   });

  // If any provider is available, let's test it
  if (kernel.getStatus().availableProviders.length > 0) {
    const agent = defineAgent({
      name: 'test-agent',
      description: 'Tests provider connectivity',
      capabilities: [{ id: 'test', name: 'Test', description: 'Test connectivity', confidence: 1 }],
      tools: [],
      instructions: 'You are a test agent. Respond with a single short sentence.',
    });

    kernel.agentRegistry.register(agent.definition, agent.executor);
    await kernel.start();

    const result = await kernel.submit({
      goal: 'Say hello and tell me which model you are.',
      intentType: 'query',
    });

    console.log('Response:', result.result?.summary);
    console.log('');
    await kernel.stop();
  } else {
    console.log('No providers configured. Set at least one API key to test.');
    console.log('');
  }
}

main().catch(console.error);
