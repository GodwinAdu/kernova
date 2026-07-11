/**
 * Custom Agent Example
 * 
 * Shows how to create an agent with custom logic that uses
 * the LLM as a reasoning tool within a larger workflow.
 * 
 * Run:
 *   npx tsx examples/custom-agent.ts
 */

import { KernovaKernel, defineAgent } from '@kernova/core';

async function main() {
  const kernel = new KernovaKernel({
    environment: 'development',
    debug: true,
  });

  // Custom agent with its own execute logic
  const codeReviewer = defineAgent({
    name: 'code-reviewer',
    description: 'Reviews code and provides feedback',
    capabilities: [
      { id: 'review', name: 'Code Review', description: 'Analyzes code quality', confidence: 0.9 },
    ],
    tools: [],
    instructions: `You are a senior code reviewer. You look for:
- Bugs and logic errors
- Security vulnerabilities
- Performance issues
- Code style improvements
Be constructive and concise. Format as a list of findings.`,

    // Custom executor that uses LLM + custom logic
    async execute(intent, context, tools) {
      const startTime = Date.now();

      tools.log('Starting code review...');
      tools.emit('review.started', { goal: intent.goal });

      // Use the LLM to analyze the code
      const analysis = await tools.complete(
        `Review the following code and provide findings:\n\n${intent.goal}`
      );

      // Store the review in memory for future reference
      await tools.remember(`Code review: ${analysis.slice(0, 200)}`, 'session');

      const durationMs = Date.now() - startTime;
      tools.emit('review.completed', { durationMs, findingsLength: analysis.length });

      return {
        success: true,
        data: { analysis, reviewedAt: new Date().toISOString() },
        summary: analysis,
        evidence: {
          sources: [{
            type: 'memory',
            ref: 'llm-analysis',
            label: 'LLM code analysis',
            consultedAt: new Date().toISOString(),
          }],
          confidence: 0.85,
          reasoning: 'Code reviewed by LLM with senior reviewer instructions',
        },
        durationMs,
      };
    },
  });

  // Register and start
  kernel.agentRegistry.register(codeReviewer.definition, codeReviewer.executor);
  await kernel.start();

  // Submit a code review intent
  const result = await kernel.submit({
    goal: `
function getUserData(id) {
  const query = "SELECT * FROM users WHERE id = " + id;
  const result = db.execute(query);
  return result;
}`,
    intentType: 'analysis',
    priority: 'high',
  });

  console.log('');
  console.log('Code Review Result:');
  console.log('═══════════════════');
  console.log(result.result?.summary);
  console.log('');

  await kernel.stop();
}

main().catch((error) => {
  console.error('Error:', error.message);
  process.exit(1);
});
