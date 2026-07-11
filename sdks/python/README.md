# Kernova Python SDK

HTTP client for the Kernova Gateway API.

## Installation

```bash
pip install kernova
# or from source
pip install -e ./sdks/python
```

## Usage

### Synchronous

```python
from kernova import Kernova

client = Kernova(base_url="http://localhost:3000", api_key="your-key")

# Submit an intent
result = client.ask("Summarize today's emails", type="query", priority="high")
print(result.answer)

# OpenAI-compatible chat
reply = client.chat([{"role": "user", "content": "Hello!"}])
print(reply)

# Health check
status = client.health()
print(f"Running: {status.running}, Agents: {status.agents}")
```

### Async

```python
import asyncio
from kernova import AsyncKernova

async def main():
    client = AsyncKernova(api_key="your-key")
    result = await client.ask("What meetings do I have today?")
    print(result.answer)

asyncio.run(main())
```

## API

### `Kernova(base_url, api_key)`
- `ask(goal, type="query", priority="medium", owner=None)` → `IntentResult`
- `chat(messages, model="kernova")` → `str`
- `health()` → `HealthStatus`

### `AsyncKernova(base_url, api_key)`
Same methods as above, but async.
