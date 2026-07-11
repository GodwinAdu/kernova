import Foundation

// MARK: - Models

/// Result of submitting an intent.
public struct IntentResult: Codable, Sendable {
    public let id: String
    public let status: String
    public let success: Bool
    public let answer: String
    public let durationMs: Int?
}

/// Gateway health status.
public struct HealthStatus: Codable, Sendable {
    public let running: Bool
    public let agents: Int
    public let activeIntents: Int
}

/// A chat message for the OpenAI-compatible endpoint.
public struct ChatMessage: Codable, Sendable {
    public let role: String
    public let content: String

    public init(role: String, content: String) {
        self.role = role
        self.content = content
    }
}

// MARK: - Errors

public enum KernovaError: Error, LocalizedError {
    case httpError(statusCode: Int, body: String)
    case noChoices
    case invalidURL
    case decodingFailed(Error)

    public var errorDescription: String? {
        switch self {
        case .httpError(let code, let body):
            return "API error (status \(code)): \(body)"
        case .noChoices:
            return "No choices in chat response"
        case .invalidURL:
            return "Invalid URL"
        case .decodingFailed(let error):
            return "Decoding failed: \(error.localizedDescription)"
        }
    }
}

// MARK: - Client

/// Kernova Swift SDK — async HTTP client for the Kernova Gateway API.
public final class KernovaClient: Sendable {
    private let baseURL: String
    private let apiKey: String?
    private let session: URLSession

    public init(baseURL: String = "http://localhost:3000", apiKey: String? = nil) {
        self.baseURL = baseURL.hasSuffix("/") ? String(baseURL.dropLast()) : baseURL
        self.apiKey = apiKey

        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 120
        self.session = URLSession(configuration: config)
    }

    /// Submit an intent and return the result.
    public func ask(goal: String, type: String = "query", priority: String = "medium") async throws -> IntentResult {
        let body: [String: Any] = ["goal": goal, "type": type, "priority": priority]
        let data = try await post(path: "/v1/intents", body: body)

        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let id = json["id"] as? String,
              let status = json["status"] as? String,
              let result = json["result"] as? [String: Any] else {
            throw KernovaError.decodingFailed(NSError(domain: "Kernova", code: -1))
        }

        return IntentResult(
            id: id,
            status: status,
            success: result["success"] as? Bool ?? false,
            answer: result["summary"] as? String ?? "",
            durationMs: result["durationMs"] as? Int
        )
    }

    /// Send an OpenAI-compatible chat completion request.
    public func chat(messages: [ChatMessage], model: String = "kernova") async throws -> String {
        let msgDicts = messages.map { ["role": $0.role, "content": $0.content] }
        let body: [String: Any] = ["model": model, "messages": msgDicts]
        let data = try await post(path: "/v1/chat/completions", body: body)

        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let choices = json["choices"] as? [[String: Any]],
              let first = choices.first,
              let message = first["message"] as? [String: Any],
              let content = message["content"] as? String else {
            throw KernovaError.noChoices
        }

        return content
    }

    /// Check gateway health.
    public func health() async throws -> HealthStatus {
        guard let url = URL(string: "\(baseURL)/health") else {
            throw KernovaError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        applyHeaders(to: &request)

        let (data, response) = try await session.data(for: request)
        try checkResponse(response, data: data)

        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw KernovaError.decodingFailed(NSError(domain: "Kernova", code: -1))
        }

        return HealthStatus(
            running: json["running"] as? Bool ?? false,
            agents: json["agents"] as? Int ?? 0,
            activeIntents: json["activeIntents"] as? Int ?? 0
        )
    }

    // MARK: - Private

    private func post(path: String, body: [String: Any]) async throws -> Data {
        guard let url = URL(string: "\(baseURL)\(path)") else {
            throw KernovaError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        applyHeaders(to: &request)

        let (data, response) = try await session.data(for: request)
        try checkResponse(response, data: data)
        return data
    }

    private func applyHeaders(to request: inout URLRequest) {
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let apiKey {
            request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        }
    }

    private func checkResponse(_ response: URLResponse, data: Data) throws {
        guard let httpResponse = response as? HTTPURLResponse else { return }
        guard (200...299).contains(httpResponse.statusCode) else {
            let body = String(data: data, encoding: .utf8) ?? ""
            throw KernovaError.httpError(statusCode: httpResponse.statusCode, body: body)
        }
    }
}
