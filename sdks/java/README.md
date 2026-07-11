# Kernova Java SDK

HTTP client for the Kernova Gateway API. Requires Java 17+.

## Installation

Add to your `pom.xml`:

```xml
<dependency>
    <groupId>dev.kernova</groupId>
    <artifactId>kernova-sdk</artifactId>
    <version>0.1.0</version>
</dependency>
```

## Usage

```java
import dev.kernova.Kernova;
import java.util.List;
import java.util.Map;

public class Example {
    public static void main(String[] args) throws Exception {
        var client = new Kernova("http://localhost:3000", "your-api-key");

        // Submit an intent
        var result = client.ask("Summarize today's emails", "query", "high");
        System.out.println(result.answer());

        // OpenAI-compatible chat
        var reply = client.chat(List.of(
            Map.of("role", "user", "content", "Hello!")
        ));
        System.out.println(reply);

        // Health check
        var health = client.health();
        System.out.printf("Running: %s, Agents: %d%n", health.running(), health.agents());
    }
}
```

## API

### `new Kernova(baseUrl, apiKey)`
### `ask(goal, type, priority)` → `IntentResult`
### `chat(messages, model)` → `String`
### `health()` → `HealthStatus`
