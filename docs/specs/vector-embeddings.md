# Spec: Vector Embeddings for Semantic Memory Search

## Summary

Add vector embedding support to the memory system so that queries find semantically related memories, not just keyword matches.

## Problem

FTS5 is keyword search: "What's the weather?" won't match a memory about "temperature forecast." Semantic search understands meaning, not just words.

## Design

### Architecture

```
MemoryEngine.store(content)
   ↓
EmbeddingEngine.embed(content) → float[1536]
   ↓
Store vector in SQLite (serialized) or vector table
   ↓

MemoryEngine.query({ query: "..." })
   ↓
EmbeddingEngine.embed(query) → float[1536]
   ↓
Cosine similarity against stored vectors
   ↓
Ranked results (semantic relevance)
```

### Key Decisions

1. **SQLite-native** — Store vectors as BLOBs (no external vector DB for v0.x)
2. **Cosine similarity in JS** — Fast enough for <100k memories
3. **Lazy embedding** — Generate embeddings on store, not retroactively
4. **Hybrid search** — Combine FTS5 (keywords) + vector (semantic) scores
5. **Provider-agnostic** — Use model router's embed() capability

## Success Criteria

- [ ] Semantic queries find related memories even without keyword overlap
- [ ] Hybrid scoring combines keyword + semantic relevance
- [ ] Works with any embedding provider (OpenAI, Gemini, local)
- [ ] Falls back to FTS5-only when no embedding provider available
