# Kernova C# SDK

Async HTTP client for the Kernova Gateway API. Targets .NET 8.

## Installation

```bash
dotnet add package Kernova.SDK
# or reference the project directly
dotnet add reference ./sdks/csharp/Kernova.SDK.csproj
```

## Usage

```csharp
using Kernova.SDK;

var client = new KernovaClient("http://localhost:3000", "your-api-key");

// Submit an intent
var result = await client.AskAsync("Summarize today's emails", type: "query", priority: "high");
Console.WriteLine(result.Answer);

// OpenAI-compatible chat
var reply = await client.ChatAsync(new[]
{
    new ChatMessage("user", "Hello!")
});
Console.WriteLine(reply);

// Health check
var health = await client.HealthAsync();
Console.WriteLine($"Running: {health.Running}, Agents: {health.Agents}");
```

## API

### `new KernovaClient(baseUrl, apiKey)`
### `AskAsync(goal, type, priority)` → `Task<IntentResult>`
### `ChatAsync(messages, model)` → `Task<string>`
### `HealthAsync()` → `Task<HealthStatus>`
