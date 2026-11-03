# Spec: Model Provider System

> Written BEFORE implementation, as required by CONTRIBUTING.md.

## Summary

Connect the Kernova runtime to real LLM providers (OpenAI, Anthropic) so that agents can reason, generate, and respond using actual AI models.

## Problem

Currently, the agent executor is a stub — it receives an intent but doesn't actually call any AI model. The runtime needs a provider-agnostic model layer.

## Design

### Architecture

```
Agent Executor
      ↓
Model Router (selects provider + model based on agent config)
      ↓
Provider Interface (abstract contract)
      ↓
┌──────────────┐  ┌────────────────┐  ┌──────────────┐
│   OpenAI     │  │   Anthropic    │  │   Ollama     │
│   Provider   │  │   Provider     │  │   Provider   │
└──────────────┘  └────────────────┘  └──────────────┘
```

### Key Decisions

1. **Provider-agnostic interface** — Agents don't know which model they're using
2. **Model Router** — Selects the best model based on intent type and agent config
3. **Fallback chains** — If primary model fails, try secondary
4. **Token tracking** — Every model call tracks tokens consumed
5. **Evidence generation** — Model responses include reasoning traces

### Provider Interface

```typescript
interface ModelProvider {
  id: string;
  name: string;
  complete(request: CompletionRequest): Promise<CompletionResponse>;
  embed?(text: string): Promise<number[]>;
}
```

### Configuration

Models are configured at two levels:
1. **Project level** — `kernova.config.json` defines default provider/model
2. **Agent level** — Each agent can override the default

## Success Criteria

- [ ] `kernova dev` + submit intent → real LLM response
- [ ] Works with OpenAI (GPT-4o)
- [ ] Works with Anthropic (Claude)
- [ ] Fallback if primary provider fails
- [ ] Token usage tracked per intent
- [ ] Agent instructions are sent as system prompt
- [ ] Context/memory is included in the prompt
