---
title: Budget & Rate Limiting
description: Control costs and prevent abuse with token budgets and rate limits.
---

# Budget & Rate Limiting

Nexus enforces spending and rate limits to prevent runaway costs.

## Setting Budgets

```typescript
// Global limits
kernel.budget.setGlobalBudget({
  maxTokens: 1_000_000,        // Total token limit
  maxCostUsd: 50.00,           // USD spending cap
  maxTokensPerIntent: 10_000,  // Single intent limit
  requestsPerMinute: 60,       // Rate limit
});

// Per-identity limits
kernel.budget.setIdentityBudget(userId, {
  maxTokensPerDay: 100_000,
  maxTokensPerHour: 20_000,
  requestsPerMinute: 10,
  maxCostPerDayUsd: 5.00,
});
```

## How It Works

1. Before every `kernel.submit()`, the budget is checked
2. If over limit, the request is rejected with a clear error message
3. After execution, actual token usage is recorded
4. Events are emitted on budget exceeded (`governance.budget.exceeded`)

## Monitoring Usage

```typescript
const usage = kernel.budget.getUsage(userId);
console.log(`Today: ${usage.tokensToday} tokens, $${usage.estimatedCostUsd.toFixed(2)}`);

const global = kernel.budget.getGlobalUsage();
console.log(`Total: ${global.totalTokens} tokens across ${global.totalRequests} requests`);
```

## Resetting Counters

Call on a schedule (cron):

```typescript
// Reset hourly counters
kernel.budget.resetHourly();

// Reset daily counters
kernel.budget.resetDaily();
```

## Cost Estimation

Nexus estimates cost at ~$3 per million tokens (average across providers). This is a rough estimate for budgeting — actual costs depend on your provider and model.
