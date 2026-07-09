# NP-003: Memory Protocol

**Version:** 0.1.0  
**Status:** Draft

## Abstract

Defines the five-layer memory system and how memories are stored, queried, and managed.

## Memory Layers

| Layer | Scope | Lifetime | Purpose |
|---|---|---|---|
| `working` | Current task | Minutes | Immediate context |
| `session` | Current interaction | Hours | Conversation state |
| `longterm` | User/project | Months-years | Learned knowledge |
| `organizational` | Company-wide | Years | Shared policies and knowledge |
| `global` | Public | Permanent | Reference information |

## Memory Entry

```json
{
  "id": "mem_uuid",
  "type": "memory_entry",
  "layer": "longterm",
  "memoryType": "fact | preference | skill | experience | relationship | procedure | context | document",
  "content": "The user prefers TypeScript.",
  "data": {},
  "relevance": 0.0-1.0,
  "confidence": 0.0-1.0,
  "tags": ["preference", "language"],
  "source": { "type": "user | agent | system | import | inference", "ref": "..." },
  "embedding": [0.1, -0.3, ...],
  "relations": [
    { "targetId": "mem_uuid", "relationType": "supports | contradicts | extends | supersedes | related", "strength": 0.8 }
  ],
  "owner": "identity_uuid",
  "accessCount": 5,
  "lastAccessedAt": "ISO8601",
  "createdAt": "ISO8601"
}
```

## Operations

### Store Memory

```
POST /memory
{ "content": "...", "layer": "longterm", "tags": ["..."] }

→ 201 Created
{ "id": "mem_uuid", ... }
```

### Query Memories

```
GET /memory?q=TypeScript&layer=longterm&limit=10

→ 200 OK
{ "memories": [...], "total": 3 }
```

### Delete Memory

```
DELETE /memory/{id}

→ 200 OK
```

## Context Computation

Context is never stored — it's computed fresh per intent:

```
User + Intent + Permissions + Knowledge + Memory + Policies → Context
```

## Search Modes

1. **Keyword** — FTS5 full-text search
2. **Semantic** — Vector cosine similarity
3. **Hybrid** — Combined keyword + semantic scoring
