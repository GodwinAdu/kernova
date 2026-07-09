# Spec: Streaming Responses

## Summary

Support token-by-token streaming from LLMs so that:
- Developers get real-time output (not waiting 5-10s for full response)
- Studio dashboard shows live generation
- Long responses don't timeout

## Design

### Architecture

```
Agent calls tools.stream(prompt)
   ↓
ModelRouter.stream(request) → AsyncGenerator<StreamChunk>
   ↓
Provider sends SSE/streaming response
   ↓
Chunks yielded to caller as they arrive
   ↓
Final response assembled and returned
```

### API

```typescript
// In agent executor
for await (const chunk of tools.stream('Explain quantum physics')) {
  process.stdout.write(chunk.content); // Token by token
}

// Or collect all
const response = await tools.streamToString('Explain quantum physics');
```

### Key Decisions

1. **AsyncGenerator** — Standard JS async iteration
2. **StreamChunk** type — content + metadata per chunk
3. **Provider-agnostic** — Same interface regardless of provider
4. **Fallback** — If provider doesn't support streaming, simulate with full response
5. **Token tracking** — Usage reported at end of stream

## Success Criteria

- [ ] OpenAI streaming works token-by-token
- [ ] AsyncGenerator API for consuming streams
- [ ] Helper to collect stream into string
- [ ] Works in agent executors via tools.stream()
- [ ] Usage stats still tracked
