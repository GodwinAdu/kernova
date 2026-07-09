# Spec: Memory Persistence (SQLite + Text Search)

> Written BEFORE implementation, as required by CONTRIBUTING.md.

## Summary

Persist the five-layer memory system to SQLite so that memories survive restarts, support text search, and scale beyond in-memory limits.

## Problem

Currently all memories exist only in RAM. When the process stops, everything is forgotten. For a system where memory is a core pillar ("What do we know?"), this makes the entire memory architecture useless in practice.

## Design

### Storage Architecture

```
MemoryEngine
   ↓
MemoryStore (SQLite)
   ├── memories table (all layers)
   ├── FTS5 full-text search index
   └── relations table (memory links)
```

### Key Decisions

1. **Same SQLite database** as events (`nexus.db`) — single file, single connection
2. **FTS5** for full-text search — built into SQLite, no external dependencies
3. **Layer-partitioned** — Each layer can be queried independently or together
4. **Relevance scoring** — Combines FTS rank + recency + access frequency
5. **Memory decay** — Relevance decreases over time unless accessed
6. **Relations preserved** — Memory-to-memory links stored separately

### Schema

```sql
CREATE TABLE memories (
  id TEXT PRIMARY KEY,
  layer TEXT NOT NULL,
  memory_type TEXT NOT NULL,
  content TEXT NOT NULL,
  data TEXT,  -- JSON
  relevance REAL NOT NULL DEFAULT 1.0,
  confidence REAL NOT NULL DEFAULT 0.8,
  tags TEXT NOT NULL DEFAULT '[]',  -- JSON array
  source TEXT NOT NULL DEFAULT '{}',  -- JSON
  owner TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  access_count INTEGER NOT NULL DEFAULT 0,
  last_accessed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE VIRTUAL TABLE memories_fts USING fts5(content, tags, tokenize='porter');

CREATE TABLE memory_relations (
  source_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  relation_type TEXT NOT NULL,
  strength REAL NOT NULL DEFAULT 1.0,
  PRIMARY KEY (source_id, target_id, relation_type)
);
```

### API

```typescript
// Store
await kernel.memoryEngine.store({ content: 'User prefers TypeScript', layer: 'longterm' });

// Query with text search
const results = await kernel.memoryEngine.query({ query: 'TypeScript', layers: ['longterm'] });

// Decay (run periodically)
await kernel.memoryEngine.decay({ factor: 0.95, minRelevance: 0.1 });
```

## Success Criteria

- [ ] Memories persist across process restarts
- [ ] Full-text search finds relevant memories
- [ ] Layer filtering works correctly
- [ ] Memory decay reduces relevance over time
- [ ] Relations between memories are preserved
- [ ] Performance: <10ms for typical queries
