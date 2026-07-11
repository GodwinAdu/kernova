# Kernova Rust SDK

Async HTTP client for the Kernova Gateway API.

## Installation

Add to your `Cargo.toml`:

```toml
[dependencies]
kernova = { path = "../sdks/rust" }
```

## Usage

```rust
use kernova::{Client, ChatMessage};

#[tokio::main]
async fn main() -> kernova::Result<()> {
    let client = Client::new("http://localhost:3000", Some("your-api-key"));

    // Submit an intent
    let result = client.ask("Summarize today's emails", "query", "high").await?;
    println!("Answer: {}", result.answer);

    // OpenAI-compatible chat
    let messages = vec![
        ChatMessage { role: "user".into(), content: "Hello!".into() },
    ];
    let reply = client.chat(&messages, "kernova").await?;
    println!("Reply: {}", reply);

    // Health check
    let health = client.health().await?;
    println!("Running: {}, Agents: {}", health.running, health.agents);

    Ok(())
}
```

## API

### `Client::new(base_url, api_key) -> Client`
### `client.ask(goal, intent_type, priority) -> Result<IntentResult>`
### `client.chat(messages, model) -> Result<String>`
### `client.health() -> Result<HealthStatus>`
