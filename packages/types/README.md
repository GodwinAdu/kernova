# @kernova/types

Type definitions for the **Kernova Runtime**.

This package contains the Universal Object Model — all TypeScript interfaces and types used across the Kernova ecosystem.

## Installation

```bash
npm install @kernova/types
```

## What's Included

- **Intent** — Structured goal objects (replaces raw prompts)
- **Agent** — Agent definitions, instances, capabilities
- **Event** — Event-native architecture types
- **Memory** — Five-layer memory system (working → global)
- **Workflow** — Multi-step execution with approval gates
- **Identity** — Users, roles, permissions, organizations
- **Model** — Provider-agnostic model types (20+ providers)
- **Streaming** — Real-time token streaming types
- **Autonomy** — Scheduler, triggers, task queue types

## Usage

```typescript
import type {
  Intent,
  IntentResult,
  AgentDefinition,
  AgentInstance,
  MemoryEntry,
  MemoryLayer,
  KernovaEvent,
  CompletionRequest,
  CompletionResponse,
  StreamChunk,
  ToolSpec,
  ToolCall,
  WorkflowDefinition,
} from '@kernova/types';
```

## Key Types

### KernovaObject (base for everything)

```typescript
interface KernovaObject {
  id: string;
  type: string;
  version: string;
  owner: string;
  status: 'created' | 'active' | 'paused' | 'completed' | 'failed' | 'archived' | 'deleted';
  createdAt: string;
  updatedAt: string;
  metadata: Record<string, unknown>;
}
```

### Intent

```typescript
interface Intent extends KernovaObject {
  goal: string;
  intentType: 'query' | 'action' | 'workflow' | 'creation' | 'analysis' | 'monitoring' | 'automation';
  priority: 'critical' | 'high' | 'medium' | 'low';
  intentStatus: 'pending' | 'planning' | 'executing' | 'completed' | 'failed';
  result?: IntentResult;
}
```

### AgentDefinition

```typescript
interface AgentDefinition extends KernovaObject {
  name: string;
  description: string;
  capabilities: Capability[];
  tools: ToolReference[];
  instructions: string;
  memoryConfig: MemoryConfig;
  concurrency: number;
}
```

### MemoryEntry

```typescript
interface MemoryEntry extends KernovaObject {
  layer: 'working' | 'session' | 'longterm' | 'organizational' | 'global';
  content: string;
  relevance: number;
  confidence: number;
  tags: string[];
}
```

## Zero Dependencies

This package contains only TypeScript type definitions. No runtime code, no dependencies.

## Documentation

Full docs at [kernova.dev](https://kernova.dev)
