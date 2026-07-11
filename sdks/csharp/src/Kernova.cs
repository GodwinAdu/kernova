using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Kernova.SDK;

/// <summary>
/// Result of submitting an intent.
/// </summary>
public record IntentResult(string Id, string Status, bool Success, string Answer, int? DurationMs);

/// <summary>
/// Gateway health status.
/// </summary>
public record HealthStatus(bool Running, int Agents, int ActiveIntents);

/// <summary>
/// A chat message for the OpenAI-compatible endpoint.
/// </summary>
public record ChatMessage(string Role, string Content);

/// <summary>
/// Kernova C# SDK — async HTTP client for the Kernova Gateway API.
/// </summary>
public class KernovaClient : IDisposable
{
    private readonly HttpClient _http;
    private readonly string _baseUrl;
    private readonly JsonSerializerOptions _jsonOptions;

    public KernovaClient(string baseUrl = "http://localhost:3000", string? apiKey = null)
    {
        _baseUrl = baseUrl.TrimEnd('/');
        _http = new HttpClient { Timeout = TimeSpan.FromSeconds(120) };
        _http.DefaultRequestHeaders.Add("Accept", "application/json");

        if (!string.IsNullOrEmpty(apiKey))
        {
            _http.DefaultRequestHeaders.Add("Authorization", $"Bearer {apiKey}");
        }

        _jsonOptions = new JsonSerializerOptions
        {
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
            DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
        };
    }

    /// <summary>
    /// Submit an intent and return the result.
    /// </summary>
    public async Task<IntentResult> AskAsync(string goal, string type = "query", string priority = "medium", CancellationToken ct = default)
    {
        var body = new { goal, type, priority };
        var response = await PostAsync("/v1/intents", body, ct);

        using var doc = await JsonDocument.ParseAsync(await response.Content.ReadAsStreamAsync(ct), cancellationToken: ct);
        var root = doc.RootElement;
        var result = root.GetProperty("result");

        return new IntentResult(
            Id: root.GetProperty("id").GetString() ?? "",
            Status: root.GetProperty("status").GetString() ?? "",
            Success: result.GetProperty("success").GetBoolean(),
            Answer: result.TryGetProperty("summary", out var summary) ? summary.GetString() ?? "" : "",
            DurationMs: result.TryGetProperty("durationMs", out var dur) ? dur.GetInt32() : null
        );
    }

    /// <summary>
    /// Send an OpenAI-compatible chat completion request.
    /// </summary>
    public async Task<string> ChatAsync(IEnumerable<ChatMessage> messages, string model = "kernova", CancellationToken ct = default)
    {
        var body = new
        {
            model,
            messages = messages.Select(m => new { role = m.Role, content = m.Content })
        };

        var response = await PostAsync("/v1/chat/completions", body, ct);

        using var doc = await JsonDocument.ParseAsync(await response.Content.ReadAsStreamAsync(ct), cancellationToken: ct);
        var root = doc.RootElement;

        return root.GetProperty("choices")[0]
            .GetProperty("message")
            .GetProperty("content")
            .GetString() ?? "";
    }

    /// <summary>
    /// Check gateway health.
    /// </summary>
    public async Task<HealthStatus> HealthAsync(CancellationToken ct = default)
    {
        var response = await _http.GetAsync($"{_baseUrl}/health", ct);
        response.EnsureSuccessStatusCode();

        using var doc = await JsonDocument.ParseAsync(await response.Content.ReadAsStreamAsync(ct), cancellationToken: ct);
        var root = doc.RootElement;

        return new HealthStatus(
            Running: root.TryGetProperty("running", out var r) && r.GetBoolean(),
            Agents: root.TryGetProperty("agents", out var a) ? a.GetInt32() : 0,
            ActiveIntents: root.TryGetProperty("activeIntents", out var ai) ? ai.GetInt32() : 0
        );
    }

    private async Task<HttpResponseMessage> PostAsync(string path, object body, CancellationToken ct)
    {
        var json = JsonSerializer.Serialize(body, _jsonOptions);
        var content = new StringContent(json, Encoding.UTF8, "application/json");
        var response = await _http.PostAsync($"{_baseUrl}{path}", content, ct);
        response.EnsureSuccessStatusCode();
        return response;
    }

    public void Dispose()
    {
        _http.Dispose();
        GC.SuppressFinalize(this);
    }
}
