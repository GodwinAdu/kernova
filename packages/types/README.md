# @kernova/types

[![npm version](https://img.shields.io/npm/v/@kernova/types.svg)](https://www.npmjs.com/package/@kernova/types)
[![npm downloads](https://img.shields.io/npm/dm/@kernova/types.svg)](https://www.npmjs.com/package/@kernova/types)
[![license](https://img.shields.io/npm/l/@kernova/types.svg)](https://github.com/GodwinAdu/kernova/blob/main/LICENSE)

**Shared TypeScript type definitions for the Kernova ecosystem, also called the Universal Object Model.**

Every Kernova package (`@kernova/core`, `@kernova/sdk`, `@kernova/framework`, `@kernova/cli`) speaks these types. Install this package when you write plugins, adapters, or integrations and want to type them without pulling in the runtime.

**[Documentation](https://kernova2026.vercel.app)** · [Protocol specs](https://kernova2026.vercel.app/protocol/overview/) · [GitHub](https://github.com/GodwinAdu/kernova)

- **Types only.** No runtime code and no dependencies
- **Tiny.** Adds nothing to your bundle (`import type`)
- **Consistent.** Every object extends one base shape, so everything is identifiable, ownable, and auditable

## Installation

```bash
npm install --save-dev @kernova/types
```

If you already use `@kernova/core` or `@kernova/sdk`, you have it as a dependency. Install it explicitly anyway when you import from it, so your `package.json` reflects what you use.

## Usage

```typescript
import type {
  Intent,
  IntentResult,
  AgentDefinition,
  MemoryEntry,
  MemoryLayer,
  KernovaEvent,
  CompletionRequest,
  CompletionResponse,
  ToolSpec,
  StreamChunk,
} from '@kernova/types';

function logEvent(event: KernovaEvent) {
  console.log(`[${event.severity}] ${event.eventType}`, event.data);
}
```

## The base object

Every Kernova object (intents, agents, memories, workflows, identities, ...) extends `KernovaObject`:

```typescript
interface KernovaObject {
  id: KernovaId;
  type: string;
  version: Version;
  owner: KernovaId;
  status: LifecycleStatus;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  metadata: Record<string, unknown>;
}
```

## What's included

| Module | Key types |
|--------|-----------|
| **Base** | `KernovaObject`, `KernovaId`, `Timestamp`, `LifecycleStatus`, `Priority`, `Confidence`, `Evidence` |
| **Intent** | `Intent`, `IntentType`, `IntentStatus`, `IntentResult`, `IntentConstraint`, `Approval`, `RiskAssessment` |
| **Agent** | `AgentDefinition`, `AgentInstance`, `AgentState`, `Capability`, `ToolReference`, `MemoryConfig`, `Permission` |
| **Event** | `KernovaEvent`, `EventCategory`, `EventSeverity`, `EventSubscription`, `EventFilter`, `Timeline` |
| **Memory** | `MemoryEntry`, `MemoryLayer`, `MemoryType`, `MemoryQuery`, `ComputedContext` |
| **Model** | `CompletionRequest`, `CompletionResponse`, `ModelMessage`, `ToolSpec`, `ToolCall`, `TokenUsage`, `ProviderConfig`, `ModelRoutingConfig` |
| **Streaming** | `StreamChunk`, `StreamRequest` |
| **Workflow** | `WorkflowDefinition`, `WorkflowInstance`, `WorkflowStep`, `RetryPolicy`, `StepResult` |
| **Identity** | `Identity`, `Role`, `Organization`, `Policy`, `PolicyRule`, `EffectivePermission` |
| **Autonomy** | `ScheduledJob`, `TaskItem`, `QueueStats`, `DeadLetterItem`, `BackgroundLoopDef`, `InboundMessage`, `OutboundMessage`, `SDKChannelAdapter` |
| **Planning** | `ExecutionPlan`, `PlanStep`, `ReflectionResult`, `ConversationMessage`, `ConversationWindow` |
| **Advanced** | `FallbackChainConfig`, `ToolDescriptor`, `ToolPolicy`, and other tool-availability types |

### Common unions

```typescript
type Priority     = 'critical' | 'high' | 'medium' | 'low';
type MemoryLayer  = 'working' | 'session' | 'longterm' | 'organizational' | 'global';
type IntentType   = 'query' | 'action' | 'workflow' | 'decision' | 'creation'
                  | 'analysis' | 'monitoring' | 'automation';
type IntentStatus = 'pending' | 'planning' | 'executing' | 'waiting' | 'reviewing'
                  | 'completed' | 'failed' | 'cancelled';
```

## Example: a typed channel adapter

```typescript
import type { SDKChannelAdapter, InboundMessage, OutboundMessage } from '@kernova/types';
```

Implement the interface and register it with `app.channel(name, adapter)` from `@kernova/sdk`.

## Deprecated aliases

`NexusId`, `NexusObject`, and `NexusEvent` are kept for backward compatibility. Use the `Kernova*` names in new code.

## Related packages

| Package | Use it for |
|---------|-----------|
| [`@kernova/core`](https://www.npmjs.com/package/@kernova/core) | The runtime that implements these types |
| [`@kernova/sdk`](https://www.npmjs.com/package/@kernova/sdk) | High-level API for agent backends |
| [`@kernova/framework`](https://www.npmjs.com/package/@kernova/framework) | Full-stack apps |

## Documentation and support

- [Protocol specs: intent, agent, memory, event, tool, identity](https://kernova2026.vercel.app/protocol/overview/)
- [Concepts](https://kernova2026.vercel.app/concepts/intents/)
- [Core API reference](https://kernova2026.vercel.app/api/core/)
- [Report a bug or request a feature](https://github.com/GodwinAdu/kernova/issues)

## Contributing

New object types must extend `KernovaObject` and be exported from the package index. See the [contributing guide](https://github.com/GodwinAdu/kernova/blob/main/CONTRIBUTING.md).

## License

[MIT](https://github.com/GodwinAdu/kernova/blob/main/LICENSE)
