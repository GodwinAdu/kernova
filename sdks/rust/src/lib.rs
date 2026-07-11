//! Kernova Rust SDK — async HTTP client for the Kernova Gateway API.

use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION, CONTENT_TYPE};
use serde::{Deserialize, Serialize};
use std::time::Duration;

/// Errors returned by the Kernova client.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("HTTP request failed: {0}")]
    Request(#[from] reqwest::Error),
    #[error("API error (status {status}): {body}")]
    Api { status: u16, body: String },
    #[error("No choices in chat response")]
    NoChoices,
}

pub type Result<T> = std::result::Result<T, Error>;

/// Result of submitting an intent.
#[derive(Debug, Clone, Deserialize)]
pub struct IntentResult {
    pub id: String,
    pub status: String,
    pub success: bool,
    pub answer: String,
    pub duration_ms: Option<u64>,
}

/// A chat message for the OpenAI-compatible endpoint.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

/// Gateway health status.
#[derive(Debug, Clone, Deserialize)]
pub struct HealthStatus {
    pub running: bool,
    pub agents: u32,
    pub active_intents: u32,
}

/// The Kernova async client.
#[derive(Debug, Clone)]
pub struct Client {
    base_url: String,
    http: reqwest::Client,
}

#[derive(Deserialize)]
struct IntentResponse {
    id: String,
    status: String,
    result: Option<IntentResultInner>,
}

#[derive(Deserialize)]
struct IntentResultInner {
    success: bool,
    summary: Option<String>,
    #[serde(rename = "durationMs")]
    duration_ms: Option<u64>,
}

#[derive(Deserialize)]
struct ChatResponse {
    choices: Vec<ChatChoice>,
}

#[derive(Deserialize)]
struct ChatChoice {
    message: ChatChoiceMessage,
}

#[derive(Deserialize)]
struct ChatChoiceMessage {
    content: String,
}

#[derive(Deserialize)]
struct HealthResponse {
    running: bool,
    agents: u32,
    #[serde(rename = "activeIntents")]
    active_intents: u32,
}

impl Client {
    /// Create a new Kernova client.
    pub fn new(base_url: &str, api_key: Option<&str>) -> Self {
        let mut headers = HeaderMap::new();
        headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
        if let Some(key) = api_key {
            if let Ok(val) = HeaderValue::from_str(&format!("Bearer {}", key)) {
                headers.insert(AUTHORIZATION, val);
            }
        }

        let http = reqwest::Client::builder()
            .default_headers(headers)
            .timeout(Duration::from_secs(120))
            .build()
            .expect("failed to build HTTP client");

        Self {
            base_url: base_url.trim_end_matches('/').to_string(),
            http,
        }
    }

    /// Submit an intent and return the result.
    pub async fn ask(&self, goal: &str, intent_type: &str, priority: &str) -> Result<IntentResult> {
        let body = serde_json::json!({
            "goal": goal,
            "type": intent_type,
            "priority": priority,
        });

        let resp = self
            .http
            .post(format!("{}/v1/intents", self.base_url))
            .json(&body)
            .send()
            .await?;

        if !resp.status().is_success() {
            let status = resp.status().as_u16();
            let body = resp.text().await.unwrap_or_default();
            return Err(Error::Api { status, body });
        }

        let data: IntentResponse = resp.json().await?;
        let result = data.result.unwrap_or(IntentResultInner {
            success: false,
            summary: None,
            duration_ms: None,
        });

        Ok(IntentResult {
            id: data.id,
            status: data.status,
            success: result.success,
            answer: result.summary.unwrap_or_default(),
            duration_ms: result.duration_ms,
        })
    }

    /// Send a chat completion request (OpenAI-compatible).
    pub async fn chat(&self, messages: &[ChatMessage], model: &str) -> Result<String> {
        let body = serde_json::json!({
            "model": model,
            "messages": messages,
        });

        let resp = self
            .http
            .post(format!("{}/v1/chat/completions", self.base_url))
            .json(&body)
            .send()
            .await?;

        if !resp.status().is_success() {
            let status = resp.status().as_u16();
            let body = resp.text().await.unwrap_or_default();
            return Err(Error::Api { status, body });
        }

        let data: ChatResponse = resp.json().await?;
        data.choices
            .into_iter()
            .next()
            .map(|c| c.message.content)
            .ok_or(Error::NoChoices)
    }

    /// Check gateway health.
    pub async fn health(&self) -> Result<HealthStatus> {
        let resp = self
            .http
            .get(format!("{}/health", self.base_url))
            .send()
            .await?;

        if !resp.status().is_success() {
            let status = resp.status().as_u16();
            let body = resp.text().await.unwrap_or_default();
            return Err(Error::Api { status, body });
        }

        let data: HealthResponse = resp.json().await?;
        Ok(HealthStatus {
            running: data.running,
            agents: data.agents,
            active_intents: data.active_intents,
        })
    }
}
