# @kernova/types

Type definitions for the **Kernova Intelligent Systems Runtime**.

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

## Usage

```typescript
import type {
  Intent,
  IntentResult,
  AgentDefinition,
  MemoryEntry,
  MemoryLayer,
  NexusEvent,
  CompletionRequest,
  CompletionResponse,
  StreamChunk,
  ToolSpec,
  ToolCall,
} from '@kernova/types';
```

## Key Types

### NexusObject (base for everything)

```typescript
interface NexusObject {
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
interface Intent extends NexusObject {
  goal: string;
  intentType: 'query' | 'action' | 'workflow' | 'creation' | 'analysis' | 'monitoring' | 'automation';
  priority: 'critical' | 'high' | 'medium' | 'low';
  intentStatus: 'pending' | 'planning' | 'executing' | 'completed' | 'failed';
  result?: IntentResult;
  evidence?: Evidence;
}
```

### MemoryEntry

```typescript
interface MemoryEntry extends NexusObject {
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
