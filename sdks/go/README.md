# Kernova Go SDK

HTTP client for the Kernova Gateway API.

## Installation

```bash
go get github.com/kernova/kernova-go
```

## Usage

```go
package main

import (
    "fmt"
    "log"

    kernova "github.com/kernova/kernova-go"
)

func main() {
    client := kernova.NewClient("http://localhost:3000", "your-api-key")

    // Submit an intent
    result, err := client.Ask("Summarize today's emails", "query", "high")
    if err != nil {
        log.Fatal(err)
    }
    fmt.Println(result.Answer)

    // OpenAI-compatible chat
    reply, err := client.Chat([]kernova.ChatMessage{
        {Role: "user", Content: "Hello!"},
    }, "kernova")
    if err != nil {
        log.Fatal(err)
    }
    fmt.Println(reply)

    // Health check
    health, err := client.Health()
    if err != nil {
        log.Fatal(err)
    }
    fmt.Printf("Running: %v, Agents: %d\n", health.Running, health.Agents)
}
```

## API

### `NewClient(baseURL, apiKey) *Client`

### `(*Client) Ask(goal, intentType, priority) (*IntentResult, error)`

### `(*Client) Chat(messages, model) (string, error)`

### `(*Client) Health() (*HealthStatus, error)`
