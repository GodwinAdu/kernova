// Package kernova provides an HTTP client for the Kernova Gateway API.
package kernova

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// Client is the Kernova API client.
type Client struct {
	BaseURL    string
	APIKey     string
	HTTPClient *http.Client
}

// IntentResult represents the response from submitting an intent.
type IntentResult struct {
	ID         string `json:"id"`
	Status     string `json:"status"`
	Success    bool   `json:"success"`
	Answer     string `json:"answer"`
	DurationMs int    `json:"durationMs,omitempty"`
}

// ChatMessage represents a single message in a chat conversation.
type ChatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// HealthStatus represents the gateway health response.
type HealthStatus struct {
	Running       bool `json:"running"`
	Agents        int  `json:"agents"`
	ActiveIntents int  `json:"activeIntents"`
}

// NewClient creates a new Kernova client with the given base URL and API key.
func NewClient(baseURL string, apiKey string) *Client {
	return &Client{
		BaseURL: baseURL,
		APIKey:  apiKey,
		HTTPClient: &http.Client{
			Timeout: 120 * time.Second,
		},
	}
}

// Ask submits an intent to the Kernova gateway and returns the result.
func (c *Client) Ask(goal string, intentType string, priority string) (*IntentResult, error) {
	if intentType == "" {
		intentType = "query"
	}
	if priority == "" {
		priority = "medium"
	}

	body := map[string]string{
		"goal":     goal,
		"type":     intentType,
		"priority": priority,
	}

	jsonBody, err := json.Marshal(body)
	if err != nil {
		return nil, fmt.Errorf("kernova: failed to marshal request: %w", err)
	}

	req, err := http.NewRequest("POST", c.BaseURL+"/v1/intents", bytes.NewReader(jsonBody))
	if err != nil {
		return nil, fmt.Errorf("kernova: failed to create request: %w", err)
	}
	c.setHeaders(req)

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("kernova: request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		return nil, fmt.Errorf("kernova: unexpected status %d", resp.StatusCode)
	}

	var raw struct {
		ID     string `json:"id"`
		Status string `json:"status"`
		Result struct {
			Success    bool   `json:"success"`
			Summary    string `json:"summary"`
			DurationMs int    `json:"durationMs"`
		} `json:"result"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil {
		return nil, fmt.Errorf("kernova: failed to decode response: %w", err)
	}

	return &IntentResult{
		ID:         raw.ID,
		Status:     raw.Status,
		Success:    raw.Result.Success,
		Answer:     raw.Result.Summary,
		DurationMs: raw.Result.DurationMs,
	}, nil
}

// Chat sends messages using the OpenAI-compatible chat completions endpoint.
func (c *Client) Chat(messages []ChatMessage, model string) (string, error) {
	if model == "" {
		model = "kernova"
	}

	body := map[string]interface{}{
		"model":    model,
		"messages": messages,
	}

	jsonBody, err := json.Marshal(body)
	if err != nil {
		return "", fmt.Errorf("kernova: failed to marshal request: %w", err)
	}

	req, err := http.NewRequest("POST", c.BaseURL+"/v1/chat/completions", bytes.NewReader(jsonBody))
	if err != nil {
		return "", fmt.Errorf("kernova: failed to create request: %w", err)
	}
	c.setHeaders(req)

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("kernova: request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("kernova: unexpected status %d: %s", resp.StatusCode, string(bodyBytes))
	}

	var raw struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil {
		return "", fmt.Errorf("kernova: failed to decode response: %w", err)
	}

	if len(raw.Choices) == 0 {
		return "", fmt.Errorf("kernova: no choices in response")
	}

	return raw.Choices[0].Message.Content, nil
}

// Health checks the gateway health status.
func (c *Client) Health() (*HealthStatus, error) {
	req, err := http.NewRequest("GET", c.BaseURL+"/health", nil)
	if err != nil {
		return nil, fmt.Errorf("kernova: failed to create request: %w", err)
	}
	c.setHeaders(req)

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("kernova: request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("kernova: unexpected status %d", resp.StatusCode)
	}

	var status HealthStatus
	if err := json.NewDecoder(resp.Body).Decode(&status); err != nil {
		return nil, fmt.Errorf("kernova: failed to decode response: %w", err)
	}

	return &status, nil
}

func (c *Client) setHeaders(req *http.Request) {
	req.Header.Set("Content-Type", "application/json")
	if c.APIKey != "" {
		req.Header.Set("Authorization", "Bearer "+c.APIKey)
	}
}
