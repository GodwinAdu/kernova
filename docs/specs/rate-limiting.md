# Spec: Rate Limiting & Cost Control

## Summary

Prevent runaway costs and abuse by enforcing token budgets, request rate limits, and spending caps at multiple levels.

## Design

### Enforcement Levels

1. **Global** — Total budget for the entire runtime
2. **Per-identity** — Budget per user/agent
3. **Per-intent** — Maximum tokens for a single intent
4. **Per-minute** — Rate limit (requests per time window)

### Components

```
BudgetManager
  ├── TokenBudget (track & enforce token limits)
  ├── RateLimiter (sliding window rate limiting)  
  └── CostTracker (estimate USD cost from token usage)
```

### API

```typescript
// Configure budgets
kernel.budget.setGlobalBudget({ maxTokens: 1_000_000, maxCostUsd: 10.00 });
kernel.budget.setIdentityBudget(userId, { maxTokensPerDay: 100_000 });
kernel.budget.setRateLimit({ requestsPerMinute: 60 });

// Check before LLM call (throws if over budget)
kernel.budget.check(identityId, estimatedTokens);

// Get usage
kernel.budget.getUsage(identityId); // { tokens, cost, requests }
```

## Success Criteria

- [ ] Token budgets enforced before LLM calls
- [ ] Rate limiting with sliding window
- [ ] Per-identity and global budgets
- [ ] Cost estimation from token usage
- [ ] Budget exceeded errors are actionable
- [ ] Usage queryable via API
