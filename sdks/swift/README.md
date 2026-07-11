# Kernova Swift SDK

Async HTTP client for the Kernova Gateway API. Uses Swift concurrency (async/await).

## Installation

Add to your `Package.swift`:

```swift
dependencies: [
    .package(path: "../sdks/swift")
]
```

## Usage

```swift
import Kernova

let client = KernovaClient(baseURL: "http://localhost:3000", apiKey: "your-api-key")

// Submit an intent
let result = try await client.ask(goal: "Summarize today's emails", type: "query", priority: "high")
print(result.answer)

// OpenAI-compatible chat
let reply = try await client.chat(messages: [
    ChatMessage(role: "user", content: "Hello!")
])
print(reply)

// Health check
let health = try await client.health()
print("Running: \(health.running), Agents: \(health.agents)")
```

## API

### `KernovaClient(baseURL:apiKey:)`
### `ask(goal:type:priority:)` → `IntentResult`
### `chat(messages:model:)` → `String`
### `health()` → `HealthStatus`

## Requirements

- Swift 5.9+
- macOS 13+ / iOS 16+
