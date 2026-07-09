/**
 * Tool Calling Example
 * 
 * Demonstrates how agents use plugin tools during LLM reasoning.
 * The LLM decides which tool to call based on the intent goal.
 * 
 * Flow:
 *   1. Register tools as plugins
 *   2. Submit an intent that requires tool use
 *   3. LLM reasons about which tool to use
 *   4. Tool is executed, result fed back to LLM
 *   5. LLM produces final answer incorporating tool results
 * 
 * Prerequisites:
 *   Set OPENAI_API_KEY (tool calling works best with OpenAI/Anthropic)
 * 
 * Run:
 *   npx tsx examples/tool-calling.ts
 */

import { NexusKernel, defineAgent } from '@nexus/core';
import type { NexusPlugin } from '@nexus/core';

async function main() {
  const kernel = new NexusKernel({
    environment: 'development',
    debug: false,
    ephemeral: true, // No persistence for this demo
  });

  // === Register Tools as Plugins ===

  const mathPlugin: NexusPlugin = {
    id: 'math',
    name: 'Math Tools',
    version: '1.0.0',
    type: 'tool',
    tools: [
      {
        id: 'calculate',
        name: 'calculate',
        description: 'Evaluate a mathematical expression. Supports basic arithmetic, exponents, and common functions.',
        parameters: {
          type: 'object',
          properties: {
            expression: { type: 'string', description: 'The math expression to evaluate (e.g., "2 + 2", "sqrt(16)")' },
          },
          required: ['expression'],
        },
        execute: async (params) => {
          const expr = params.expression as string;
          try {
            // Simple safe eval for basic math
            const sanitized = expr.replace(/[^0-9+\-*/().%\s^]/g, '');
            const result = Function(`"use strict"; return (${sanitized})`)();
            return { expression: expr, result: Number(result) };
          } catch {
            return { expression: expr, error: 'Invalid expression' };
          }
        },
      },
    ],
  };

  const timePlugin: NexusPlugin = {
    id: 'time',
    name: 'Time Tools',
    version: '1.0.0',
    type: 'tool',
    tools: [
      {
        id: 'current_time',
        name: 'current_time',
        description: 'Get the current date and time',
        parameters: {
          type: 'object',
          properties: {
            timezone: { type: 'string', description: 'Timezone (e.g., "UTC", "America/New_York")' },
          },
        },
        execute: async (params) => {
          const tz = (params.timezone as string) || 'UTC';
          const now = new Date().toLocaleString('en-US', { timeZone: tz });
          return { timezone: tz, datetime: now };
        },
      },
    ],
  };

  const weatherPlugin: NexusPlugin = {
    id: 'weather',
    name: 'Weather Tools',
    version: '1.0.0',
    type: 'tool',
    tools: [
      {
        id: 'get_weather',
        name: 'get_weather',
        description: 'Get current weather for a location',
        parameters: {
          type: 'object',
          properties: {
            location: { type: 'string', description: 'City name (e.g., "London", "New York")' },
          },
          required: ['location'],
        },
        execute: async (params) => {
          // Simulated weather data (in production, call a real API)
          const location = params.location as string;
          const conditions = ['sunny', 'cloudy', 'rainy', 'partly cloudy'];
          const temp = Math.floor(Math.random() * 30) + 5;
          return {
            location,
            temperature: `${temp}°C`,
            condition: conditions[Math.floor(Math.random() * conditions.length)],
            humidity: `${Math.floor(Math.random() * 60) + 30}%`,
          };
        },
      },
    ],
  };

  // Register plugins
  await kernel.plugins.register(mathPlugin);
  await kernel.plugins.register(timePlugin);
  await kernel.plugins.register(weatherPlugin);

  // === Define an Agent with Tool Access ===

  const assistant = defineAgent({
    name: 'tool-assistant',
    description: 'An assistant that can use tools to answer questions',
    capabilities: [
      { id: 'general', name: 'General', description: 'General with tools', confidence: 0.9 },
    ],
    tools: [],
    instructions: `You are a helpful assistant with access to tools.
Use tools when the user asks about:
- Math calculations → use the calculate tool
- Current time → use the current_time tool
- Weather → use the get_weather tool
Always use tools when available rather than guessing.`,
  });

  kernel.agentRegistry.register(assistant.definition, assistant.executor);
  await kernel.start();

  // Check if we have a model provider
  const status = kernel.getStatus();
  if (status.availableProviders.length === 0) {
    console.log('');
    console.log('  ⚠ No model provider configured.');
    console.log('  Set OPENAI_API_KEY to test tool calling with a real LLM.');
    console.log('');
    console.log('  Registered tools:');
    kernel.plugins.listTools().forEach(t => {
      console.log(`    • ${t.id}: ${t.description}`);
    });
    console.log('');
    console.log('  Testing direct tool execution:');
    const mathResult = await kernel.plugins.executeTool('math:calculate', { expression: '42 * 3.14' });
    console.log(`    math:calculate("42 * 3.14") → ${JSON.stringify(mathResult)}`);
    const timeResult = await kernel.plugins.executeTool('time:current_time', { timezone: 'UTC' });
    console.log(`    time:current_time("UTC") → ${JSON.stringify(timeResult)}`);
    console.log('');
    await kernel.stop();
    return;
  }

  console.log('');
  console.log('  Tool Calling Demo');
  console.log('  ═════════════════');
  console.log(`  Providers: ${status.availableProviders.join(', ')}`);
  console.log(`  Tools: ${kernel.plugins.listTools().map(t => t.id).join(', ')}`);
  console.log('');

  // Submit intents that require tool use
  const intents = [
    'What is 847 * 23 + 156?',
    'What time is it in UTC right now?',
    'What is the weather like in Tokyo?',
  ];

  for (const goal of intents) {
    console.log(`  → ${goal}`);
    const result = await kernel.submit({ goal, intentType: 'query' });
    console.log(`  ← ${result.result?.summary?.slice(0, 100)}`);
    console.log('');
  }

  // Show token usage
  const finalStatus = kernel.getStatus();
  console.log(`  Tokens used: ${finalStatus.modelUsage.usage.totalTokens}`);
  console.log('');

  await kernel.stop();
}

main().catch(console.error);
