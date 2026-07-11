package dev.kernova;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.List;
import java.util.Map;

/**
 * Kernova Java SDK — HTTP client for the Kernova Gateway API.
 */
public class Kernova {

    private final String baseUrl;
    private final String apiKey;
    private final HttpClient httpClient;
    private final ObjectMapper mapper;

    public Kernova(String baseUrl, String apiKey) {
        this.baseUrl = baseUrl.replaceAll("/+$", "");
        this.apiKey = apiKey;
        this.httpClient = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(30))
                .build();
        this.mapper = new ObjectMapper();
    }

    public Kernova(String baseUrl) {
        this(baseUrl, null);
    }

    /**
     * Result of an intent submission.
     */
    public record IntentResult(String id, String status, boolean success, String answer, Integer durationMs) {}

    /**
     * Gateway health status.
     */
    public record HealthStatus(boolean running, int agents, int activeIntents) {}

    /**
     * Submit an intent and return the result.
     */
    public IntentResult ask(String goal, String type, String priority) throws Exception {
        var body = mapper.writeValueAsString(Map.of(
                "goal", goal,
                "type", type != null ? type : "query",
                "priority", priority != null ? priority : "medium"
        ));

        var request = buildRequest("/v1/intents")
                .POST(HttpRequest.BodyPublishers.ofString(body))
                .build();

        var response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
        checkStatus(response);

        var node = mapper.readTree(response.body());
        var resultNode = node.path("result");

        return new IntentResult(
                node.path("id").asText(""),
                node.path("status").asText(""),
                resultNode.path("success").asBoolean(false),
                resultNode.path("summary").asText(""),
                resultNode.has("durationMs") ? resultNode.path("durationMs").asInt() : null
        );
    }

    /**
     * Submit an intent with default type and priority.
     */
    public IntentResult ask(String goal) throws Exception {
        return ask(goal, "query", "medium");
    }

    /**
     * Send an OpenAI-compatible chat completion request.
     */
    public String chat(List<Map<String, String>> messages, String model) throws Exception {
        var body = mapper.writeValueAsString(Map.of(
                "model", model != null ? model : "kernova",
                "messages", messages
        ));

        var request = buildRequest("/v1/chat/completions")
                .POST(HttpRequest.BodyPublishers.ofString(body))
                .build();

        var response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
        checkStatus(response);

        var node = mapper.readTree(response.body());
        return node.path("choices").get(0).path("message").path("content").asText();
    }

    /**
     * Send a chat message with default model.
     */
    public String chat(List<Map<String, String>> messages) throws Exception {
        return chat(messages, "kernova");
    }

    /**
     * Check the gateway health.
     */
    public HealthStatus health() throws Exception {
        var request = buildRequest("/health")
                .GET()
                .build();

        var response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
        checkStatus(response);

        var node = mapper.readTree(response.body());
        return new HealthStatus(
                node.path("running").asBoolean(false),
                node.path("agents").asInt(0),
                node.path("activeIntents").asInt(0)
        );
    }

    private HttpRequest.Builder buildRequest(String path) {
        var builder = HttpRequest.newBuilder()
                .uri(URI.create(baseUrl + path))
                .header("Content-Type", "application/json")
                .timeout(Duration.ofSeconds(120));

        if (apiKey != null && !apiKey.isEmpty()) {
            builder.header("Authorization", "Bearer " + apiKey);
        }
        return builder;
    }

    private void checkStatus(HttpResponse<String> response) throws KernovaException {
        if (response.statusCode() >= 400) {
            throw new KernovaException(
                    "API error (status " + response.statusCode() + "): " + response.body(),
                    response.statusCode()
            );
        }
    }

    /**
     * Exception thrown when the Kernova API returns an error.
     */
    public static class KernovaException extends Exception {
        private final int statusCode;

        public KernovaException(String message, int statusCode) {
            super(message);
            this.statusCode = statusCode;
        }

        public int getStatusCode() {
            return statusCode;
        }
    }
}
