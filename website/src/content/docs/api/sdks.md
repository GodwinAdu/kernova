---
title: "Multi-Language SDKs"
description: Use Kernova from Python, Go, Rust, Java, C#, or Swift — HTTP client libraries for every major platform.
---

Kernova provides official SDKs for **7 languages** plus a raw REST API. Each SDK wraps the Kernova HTTP API with idiomatic patterns for its ecosystem — connection pooling, error handling, streaming, and type safety included.

## SDK Matrix

| Language | Package | Install |
|----------|---------|---------|
| TypeScript | `@kernova/sdk` | `npm install @kernova/sdk` |
| Python | `kernova` | `pip install kernova` |
| Go | `github.com/GodwinAdu/kernova/sdks/go` | `go get github.com/GodwinAdu/kernova/sdks/go` |
| Rust | `kernova` | `cargo add kernova` |
| Java | `dev.kernova:kernova-sdk` | Maven / Gradle |
| C# | `Kernova.SDK` | `dotnet add package Kernova.SDK` |
| Swift | `Kernova` | Swift Package Manager |

---

## TypeScript

### Installation

```bash
npm install @kernova/sdk
```

### Quick Usage

```typescript
import { Kernova } from "@kernova/sdk";

const client = new Kernova({
  apiKey: process.env.KERNOVA_API_KEY,
  baseUrl: "http://localhost:3000",
});

// Health check
const status = await client.health();
console.log(status); // { status: "ok", version: "1.0.0" }

// Ask a single question
const answer = await client.ask("What is the capital of France?");
console.log(answer.text);

// Multi-turn chat
const chat = client.chat({ model: "default" });
chat.send("Hello, who are you?");
const reply = await chat.receive();
console.log(reply.text);
```

### Notes

- Full TypeScript types included — no `@types` package needed
- Supports both Node.js (18+) and edge runtimes (Cloudflare Workers, Vercel Edge)
- Streaming responses via `client.askStream()` returning an `AsyncIterable`
- ESM and CJS builds included

---

## Python

### Installation

```bash
pip install kernova
```

### Quick Usage

```python
from kernova import Kernova

client = Kernova(
    api_key="your-api-key",
    base_url="http://localhost:3000",
)

# Health check
status = client.health()
print(status)  # {"status": "ok", "version": "1.0.0"}

# Ask a single question
answer = client.ask("What is the capital of France?")
print(answer.text)

# Multi-turn chat
chat = client.chat(model="default")
chat.send("Hello, who are you?")
reply = chat.receive()
print(reply.text)
```

### Async Usage

```python
import asyncio
from kernova import AsyncKernova

async def main():
    client = AsyncKernova(api_key="your-api-key")
    answer = await client.ask("Explain quantum computing briefly.")
    print(answer.text)

asyncio.run(main())
```

### Notes

- Requires Python 3.9+
- Async client via `AsyncKernova` (built on `httpx`)
- Streaming with `async for chunk in client.ask_stream(...)`
- Pydantic models for all response types

---

## Go

### Installation

```bash
go get github.com/GodwinAdu/kernova/sdks/go
```

### Quick Usage

```go
package main

import (
    "context"
    "fmt"
    "log"

    kernova "github.com/GodwinAdu/kernova/sdks/go"
)

func main() {
    client := kernova.NewClient(
        kernova.WithAPIKey("your-api-key"),
        kernova.WithBaseURL("http://localhost:3000"),
    )

    ctx := context.Background()

    // Health check
    status, err := client.Health(ctx)
    if err != nil {
        log.Fatal(err)
    }
    fmt.Println(status.Status)

    // Ask a single question
    answer, err := client.Ask(ctx, &kernova.AskRequest{
        Prompt: "What is the capital of France?",
    })
    if err != nil {
        log.Fatal(err)
    }
    fmt.Println(answer.Text)

    // Multi-turn chat
    chat := client.Chat(ctx, &kernova.ChatOptions{Model: "default"})
    chat.Send("Hello, who are you?")
    reply, err := chat.Receive()
    if err != nil {
        log.Fatal(err)
    }
    fmt.Println(reply.Text)
}
```

### Notes

- Requires Go 1.21+
- Context-based cancellation and timeouts on every call
- Functional options pattern for client configuration
- Streaming via `client.AskStream()` returning a `<-chan kernova.Chunk`
- Zero external dependencies beyond the standard library

---

## Rust

### Installation

```bash
cargo add kernova
```

### Quick Usage

```rust
use kernova::Client;

#[tokio::main]
async fn main() -> Result<(), kernova::Error> {
    let client = Client::builder()
        .api_key("your-api-key")
        .base_url("http://localhost:3000")
        .build()?;

    // Health check
    let status = client.health().await?;
    println!("{}", status.status);

    // Ask a single question
    let answer = client.ask("What is the capital of France?").await?;
    println!("{}", answer.text);

    // Multi-turn chat
    let mut chat = client.chat().model("default").start().await?;
    chat.send("Hello, who are you?").await?;
    let reply = chat.receive().await?;
    println!("{}", reply.text);

    Ok(())
}
```

### Notes

- Async-first with `tokio` runtime
- Builder pattern for client and request configuration
- Streaming via `client.ask_stream()` returning a `Stream<Item = Result<Chunk>>`
- Strong typing with `serde` deserialization for all responses
- Supports `rustls` or `native-tls` via feature flags

---

## Java

### Installation

**Maven:**

```xml
<dependency>
    <groupId>dev.kernova</groupId>
    <artifactId>kernova-sdk</artifactId>
    <version>1.0.0</version>
</dependency>
```

**Gradle:**

```groovy
implementation 'dev.kernova:kernova-sdk:1.0.0'
```

### Quick Usage

```java
import dev.kernova.sdk.KernovaClient;
import dev.kernova.sdk.models.AskResponse;
import dev.kernova.sdk.models.HealthStatus;

public class Main {
    public static void main(String[] args) {
        KernovaClient client = KernovaClient.builder()
            .apiKey("your-api-key")
            .baseUrl("http://localhost:3000")
            .build();

        // Health check
        HealthStatus status = client.health();
        System.out.println(status.getStatus());

        // Ask a single question
        AskResponse answer = client.ask("What is the capital of France?");
        System.out.println(answer.getText());

        // Multi-turn chat
        ChatSession chat = client.chat("default");
        chat.send("Hello, who are you?");
        ChatMessage reply = chat.receive();
        System.out.println(reply.getText());
    }
}
```

### Notes

- Requires Java 17+
- Built on `java.net.http.HttpClient` — no external HTTP dependencies
- Async variants return `CompletableFuture<T>` (e.g., `client.askAsync(...)`)
- Streaming via reactive `Flow.Publisher<Chunk>`
- Thread-safe client — create once, share across threads

---

## C#

### Installation

```bash
dotnet add package Kernova.SDK
```

### Quick Usage

```csharp
using Kernova.SDK;

var client = new KernovaClient(new KernovaOptions
{
    ApiKey = "your-api-key",
    BaseUrl = "http://localhost:3000"
});

// Health check
var status = await client.HealthAsync();
Console.WriteLine(status.Status);

// Ask a single question
var answer = await client.AskAsync("What is the capital of France?");
Console.WriteLine(answer.Text);

// Multi-turn chat
var chat = client.CreateChat(model: "default");
await chat.SendAsync("Hello, who are you?");
var reply = await chat.ReceiveAsync();
Console.WriteLine(reply.Text);
```

### Notes

- Targets .NET 6+ / .NET Standard 2.1
- Fully async with `Task<T>` return types
- Streaming via `IAsyncEnumerable<Chunk>` with `await foreach`
- Dependency injection friendly — register `IKernovaClient` in DI container
- Cancellation token support on all async methods

---

## Swift

### Installation

Add to your `Package.swift`:

```swift
dependencies: [
    .package(url: "https://github.com/GodwinAdu/kernova-swift.git", from: "1.0.0")
]
```

### Quick Usage

```swift
import Kernova

let client = KernovaClient(
    apiKey: "your-api-key",
    baseUrl: "http://localhost:3000"
)

// Health check
let status = try await client.health()
print(status.status)

// Ask a single question
let answer = try await client.ask("What is the capital of France?")
print(answer.text)

// Multi-turn chat
let chat = client.chat(model: "default")
try await chat.send("Hello, who are you?")
let reply = try await chat.receive()
print(reply.text)
```

### Notes

- Requires Swift 5.9+ / iOS 15+ / macOS 12+
- Built on Swift concurrency (`async`/`await`)
- Streaming via `AsyncSequence` with `for try await chunk in ...`
- Codable models for all request/response types
- Works on Apple platforms and Linux (via Swift on Server)

---

## REST API (No SDK)

All SDKs wrap the same HTTP endpoints. If your language isn't listed, use any HTTP client:

```bash
# Health check
curl http://localhost:3000/api/health

# Ask a question
curl -X POST http://localhost:3000/api/ask \
  -H "Authorization: Bearer your-api-key" \
  -H "Content-Type: application/json" \
  -d '{"prompt": "What is the capital of France?"}'

# Chat (send message to session)
curl -X POST http://localhost:3000/api/chat \
  -H "Authorization: Bearer your-api-key" \
  -H "Content-Type: application/json" \
  -d '{"session_id": "abc123", "message": "Hello, who are you?"}'
```

---

## Common Configuration

All SDKs support these environment variables as defaults:

| Variable | Description |
|----------|-------------|
| `KERNOVA_API_KEY` | API key for authentication |
| `KERNOVA_BASE_URL` | Base URL of the Kernova instance |
| `KERNOVA_TIMEOUT` | Request timeout in milliseconds (default: 30000) |
| `KERNOVA_MAX_RETRIES` | Number of retries on transient failures (default: 3) |

When environment variables are set, you can create a client with no arguments:

```typescript
const client = new Kernova(); // reads from env
```

```python
client = Kernova()  # reads from env
```

```go
client := kernova.NewClient() // reads from env
```
