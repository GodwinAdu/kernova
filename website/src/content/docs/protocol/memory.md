---
title: "NP-003: Memory Protocol"
description: Five-layer memory system specification.
---

# NP-003: Memory Protocol

**Version:** 0.1.0 | **Status:** Draft

## Layers

| Layer | Scope | Lifetime |
|-------|-------|----------|
| `working` | Task | Minutes |
| `session` | Interaction | Hours |
| `longterm` | User/project | Months–years |
| `organizational` | Company | Years |
| `global` | Public | Permanent |

## Operations

- `POST /memory` — Store
- `GET /memory?q=...` — Search
- `DELETE /memory/{id}` — Delete

## Search Modes

1. **Keyword** (FTS5)
2. **Semantic** (vector cosine similarity)
3. **Hybrid** (combined scoring)
