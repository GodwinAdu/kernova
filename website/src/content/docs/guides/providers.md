---
title: Model Providers
description: Use 26 cataloged AI providers, including Azure OpenAI, AWS Bedrock, and Google Vertex AI, with structured output, reasoning, prompt caching, and multimodal input.
---

# Model Providers

Kernova is **model-agnostic**. Your application code doesn't change when you switch providers. Set an environment variable — that's it.

## Why This Matters

- **No vendor lock-in** — Switch from OpenAI to Anthropic by changing one env var
- **Cost optimization** — Use cheap models for simple tasks, expensive for complex
- **Resilience** — If one provider is down, fall back automatically
- **Local development** — Use Ollama (free, offline) while coding
- **Future-proof** — New providers work without code changes

## Supported Providers

### Cloud APIs (API key required)

| Provider | ID | Variable | Default Model | Best For |
|----------|----|----------|---------------|----------|
| OpenAI | `openai` | `OPENAI_API_KEY` | gpt-4o (or `OPENAI_MODEL`) | General purpose, vision, audio, tool calling |
| Anthropic | `anthropic` | `ANTHROPIC_API_KEY` | claude-sonnet-5-5 | Long-form reasoning, code, documents |
| Google Gemini | `gemini` | `GEMINI_API_KEY` | gemini-flash-latest | Large context, audio and video |
| DeepSeek | `deepseek` | `DEEPSEEK_API_KEY` | deepseek-chat | Cost-effective reasoning |
| Groq | `groq` | `GROQ_API_KEY` | openai/gpt-oss-120b | Ultra-fast inference |
| Mistral | `mistral` | `MISTRAL_API_KEY` | mistral-large-latest | European data residency |
| xAI (Grok) | `xai` | `XAI_API_KEY` | grok-4-latest | Real-time information |
| Cohere | `cohere` | `COHERE_API_KEY` | command-a-03-2025 | RAG and search |
| Qwen (Alibaba Cloud) | `qwen` | `DASHSCOPE_API_KEY` | qwen-plus | Qwen models, hybrid thinking |
| Moonshot (Kimi) | `moonshot` | `MOONSHOT_API_KEY` | kimi-k3.1-pro | Long context, agentic tool use |
| Z.ai (GLM) | `zai` | `ZAI_API_KEY` | glm-5.3 | GLM models |
| Together AI | `together` | `TOGETHER_API_KEY` | openai/gpt-oss-120b | 100+ open models |
| OpenRouter | `openrouter` | `OPENROUTER_API_KEY` | Any model | Access everything through one API |
| Hugging Face | `huggingface` | `HF_TOKEN` | openai/gpt-oss-120b | Open models through Inference Providers |
| NVIDIA NIM | `nvidia` | `NVIDIA_API_KEY` | meta/llama-3.3-70b-instruct | NVIDIA-hosted open models |
| Fireworks | `fireworks` | `FIREWORKS_API_KEY` | gpt-oss-120b | Fast open-model inference |
| Perplexity | `perplexity` | `PERPLEXITY_API_KEY` | sonar | Search-augmented responses |
| Cerebras | `cerebras` | `CEREBRAS_API_KEY` | gpt-oss-120b | Ultra-fast inference |
| SambaNova | `sambanova` | `SAMBANOVA_API_KEY` | Meta-Llama-3.3-70B-Instruct | Fast inference |

Aliases work too: `google` → `gemini`, `azure_openai` → `azure`, `vertex-ai` → `vertex`, `aws-bedrock` → `bedrock`, `dashscope` → `qwen`, `kimi` → `moonshot`, `glm` → `zai`.

Providers retire models regularly. When a default stops working, set the model explicitly with `models: { default: { provider, model } }`, or call [`listModels()`](#listing-models) to see what's available.

### Cloud AI Platforms

| Platform | ID | Detected when | Default Model |
|----------|----|---------------|---------------|
| Azure OpenAI / AI Foundry | `azure` | `AZURE_OPENAI_ENDPOINT` plus `AZURE_OPENAI_API_KEY` or Entra ID app credentials | `AZURE_OPENAI_DEPLOYMENT`, or gpt-4o |
| AWS Bedrock | `bedrock` | `AWS_BEARER_TOKEN_BEDROCK` (other AWS credentials: configure it) | global.anthropic.claude-sonnet-4-5-20250929-v1:0 |
| Google Vertex AI | `vertex` | `GOOGLE_GENAI_USE_VERTEXAI=true` plus Google Cloud credentials and a project | gemini-3-flash-preview |

All three authenticate without extra packages: Kernova signs AWS requests and gets Google and Microsoft tokens itself. See [Cloud Platforms](#cloud-platforms) below for the setup.

### Local Providers (no key needed)

| Provider | Setup | Best For |
|----------|-------|----------|
| Ollama | `ollama serve && ollama pull llama3.1` | Free local development |
| LM Studio | Download from lmstudio.ai | GUI for local models |
| vLLM | `python -m vllm.entrypoints.openai.api_server` | Self-hosted production |
| llama.cpp | `./server -m model.gguf` | Minimal self-hosted |

## How Auto-Detection Works

When the kernel starts, it:
1. Checks the environment for each cataloged provider (its API key variable, or the setup in the table above for cloud platforms)
2. Creates a provider for each one that's set up
3. Registers them with the model router
4. Picks the first available as the default, using that provider's default model from the tables above

Local servers (Ollama, LM Studio, vLLM, llama.cpp) aren't auto-detected; add them with `providers` or `createProviderFromConfig()`. They don't need an API key. Bedrock isn't auto-detected from plain AWS credentials, because many machines have those for other reasons; register it yourself (below) to use them.

```typescript
// You just set the env var — Kernova does the rest
// export OPENAI_API_KEY=sk-...
// export ANTHROPIC_API_KEY=sk-ant-...

const app = await Kernova.create();
// → Both OpenAI and Anthropic available
// → OpenAI used as default (first detected)
```

## Cloud Platforms

### Azure OpenAI

Azure serves the OpenAI API from your own resource. Requests name a **deployment** (the name you gave a model when you deployed it), so `model` is a deployment name.

```bash
export AZURE_OPENAI_ENDPOINT=https://my-resource.openai.azure.com   # or https://my-resource.services.ai.azure.com
export AZURE_OPENAI_API_KEY=...
export AZURE_OPENAI_DEPLOYMENT=gpt-4o                                # default deployment
export AZURE_OPENAI_EMBEDDING_DEPLOYMENT=text-embedding-3-small      # for embeddings
```

Kernova uses Azure's v1 API (`{endpoint}/openai/v1/...`), which needs no api-version. Instead of a key you can use Microsoft Entra ID:

```typescript
import { AzureOpenAIProvider } from '@kernova/core';

// App credentials (also read from AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET)
new AzureOpenAIProvider({ tenantId, clientId, clientSecret });

// The managed identity of an App Service, Functions app, Container App, or VM
new AzureOpenAIProvider({ managedIdentity: true });            // or { clientId } for a user-assigned one

// Your own token source, e.g. from @azure/identity
new AzureOpenAIProvider({ getToken: () => credential.getToken(scope).then(t => t.token) });

// The older deployment-based API
new AzureOpenAIProvider({ apiVersion: '2024-10-21' });
```

### AWS Bedrock

Bedrock serves Claude, Amazon Nova, Llama, Mistral, DeepSeek, Qwen, OpenAI gpt-oss, Cohere and more through its Converse API; Kernova uses it for all of them. Model IDs are Bedrock model IDs or inference profile IDs (`global.…`, `us.…`, `eu.…`); newer models are only offered through inference profiles.

```bash
export AWS_REGION=us-east-1
export AWS_BEARER_TOKEN_BEDROCK=...     # a Bedrock API key, or use AWS credentials:
```

Without an API key, requests are signed (SigV4) with AWS credentials, found where the AWS CLI looks:

1. Keys or a `credentials` function passed to the provider
2. `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_SESSION_TOKEN`
3. The profile (`AWS_PROFILE`, default `default`) in `~/.aws/credentials` and `~/.aws/config`: static keys or `credential_process`
4. Web identity (EKS IRSA): `AWS_WEB_IDENTITY_TOKEN_FILE` + `AWS_ROLE_ARN`
5. Container credentials (ECS, EKS Pod Identity)
6. EC2 instance metadata, with `instanceMetadata: true`

For SSO or assume-role profiles, add `credential_process = aws configure export-credentials --profile NAME --format process` to the profile.

```typescript
import { BedrockProvider } from '@kernova/core';

const bedrock = new BedrockProvider({ region: 'eu-west-1', profile: 'prod' });
const kernel = new KernovaKernel({
  providers: [bedrock],
  models: { default: { provider: 'bedrock', model: 'eu.amazon.nova-pro-v1:0' } },
});
```

Embeddings use `amazon.titan-embed-text-v2:0` by default; Cohere embed models (`embeddingModel: 'cohere.embed-v4:0'`) work too.

### Google Vertex AI

Vertex AI serves Gemini with Google Cloud authentication. Credentials are found the way Google's libraries find them:

1. `GOOGLE_APPLICATION_CREDENTIALS`: a service account key file (or an ADC file)
2. `gcloud auth application-default login` (the ADC file in your gcloud config folder)
3. The metadata server, on Cloud Run, Cloud Functions, App Engine, GKE, and Compute Engine

```bash
export GOOGLE_CLOUD_PROJECT=my-project      # optional when the credentials file names a project
export GOOGLE_CLOUD_LOCATION=global         # default; or a region such as us-central1
export GOOGLE_GENAI_USE_VERTEXAI=true       # turns on auto-detection
```

```typescript
import { VertexAIProvider } from '@kernova/core';

new VertexAIProvider({ project: 'my-project', location: 'us-central1', keyFile: './sa.json' });
new VertexAIProvider({ apiKey: process.env.VERTEX_EXPRESS_KEY });   // Vertex AI express mode
```

Gemini 3 models are served from the `global` location. Gemini 2.5 models were retired on Vertex AI in October 2026; set `defaultModel` to the model you've been given access to.

### In `kernova.config.ts`

Cloud platforms take their settings in `options`:

```typescript
models: {
  azure:   { provider: 'azure', model: 'my-gpt-deployment', options: { endpoint: 'https://my-resource.openai.azure.com' } },
  bedrock: { provider: 'bedrock', model: 'global.anthropic.claude-sonnet-4-5-20250929-v1:0', options: { region: 'us-east-1' } },
  vertex:  { provider: 'vertex', model: 'gemini-3-flash-preview', options: { project: 'my-project', location: 'global' } },
}
```

## Model Features

Every provider takes the same request fields; each translates them to its own API.

| Provider | JSON schema output | Reasoning setting | Prompt caching | Audio input | Files |
|----------|--------------------|-------------------|----------------|-------------|-------|
| OpenAI, Azure | `response_format` | `reasoning_effort` | Automatic | WAV, MP3 | PDF |
| Anthropic | `output_config.format` | Adaptive thinking + effort (Claude 4.6+), thinking budget (earlier) | `cache: true` | — | PDF (data URI or URL), plain text |
| Gemini, Vertex AI | `responseJsonSchema` | `thinkingLevel` (Gemini 3), `thinkingBudget` (2.5) | Automatic | Yes | PDF, video, and more |
| Bedrock | Forced tool (Claude, Nova, Mistral Large); an instruction otherwise | Claude thinking, Nova `reasoningConfig`, gpt-oss `reasoning_effort` | `cache: true` (Claude, Nova) | — | PDF, CSV, DOC(X), XLS(X), HTML, TXT, MD |
| OpenAI-compatible | `response_format`, where supported | `reasoning_effort`, or the API's own (OpenRouter, Qwen, Z.ai) | The API's own | Where supported | Where supported |
| Ollama | `format` | `think` | — | — | — |

A feature a model doesn't support either has no effect or is rejected by the provider with its own error message; Kernova rejects inputs it knows a provider can't take (audio for Claude, for example) before sending anything.

### Structured Output

```typescript
const response = await kernel.models.complete({
  messages: [{ role: 'user', content: 'Extract the city and temperature: "31°C in Accra"' }],
  responseFormat: {
    type: 'json_schema',
    name: 'weather',
    schema: {
      type: 'object',
      properties: { city: { type: 'string' }, celsius: { type: 'number' } },
      required: ['city', 'celsius'],
    },
  },
});

response.parsed;   // { city: 'Accra', celsius: 31 } (undefined if the answer isn't valid JSON)
```

`{ type: 'json' }` (or `jsonMode: true`) asks for any JSON object. With OpenAI, `strict: true` guarantees the schema is followed, but the schema must meet OpenAI's strict-mode rules. Claude's structured output needs closed objects, so Kernova adds `additionalProperties: false` to objects that don't say otherwise.

### Reasoning

```typescript
await kernel.models.complete({
  messages,
  reasoning: { effort: 'high' },             // 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
});

await kernel.models.complete({
  messages,
  reasoning: { budgetTokens: 8000, includeThoughts: true },
});
```

- `effort` is mapped to each provider's setting (see the table). Levels a model doesn't have become the nearest one it does: OpenAI takes `max` as `xhigh`; Claude takes `minimal` as low; Gemini 3 Pro, Kimi K3, and GLM-5.3 take only some levels (GLM-5.3 and Kimi K3 always think, so `none` becomes their lowest level).
- `budgetTokens` sets a thinking token budget where the provider takes one (Gemini, Claude before 4.6, OpenRouter, Qwen). Claude 4.6 and later only take effort levels (4.7 and later reject budgets), so a budget becomes the closest level. Claude needs `maxTokens` above a budget.
- When a request asks for reasoning without setting `maxTokens`, the output limit defaults to 16,384 tokens instead of 4,096, because thinking counts toward it. OpenAI reasoning models (`gpt-5`, `o*`) get the larger limit by default too.
- The model's reasoning comes back in `response.reasoning` (and `chunk.reasoning` when streaming) when the provider returns it. Gemini only returns it with `includeThoughts: true`.
- Thinking turns off custom temperatures on Claude, so `temperature` isn't sent while it's on.

Some providers need the model's reasoning back during tool use (Claude's signed thinking blocks; DeepSeek's, Kimi's, and GLM's `reasoning_content`). The response's `providerData` carries it: copy it onto the assistant message you send back. Agents do this for you.

### Prompt Caching

```typescript
await kernel.models.complete({ messages, tools, cache: true });
```

`cache: true` marks the stable start of the prompt (tools, system prompt, and the conversation so far) as cacheable. Claude and Bedrock need it; OpenAI, Azure, Gemini, and DeepSeek cache automatically. Cache hits show up in `usage.cachedTokens`, and Claude and Bedrock also report `usage.cacheWriteTokens`.

### Images, Audio, and Files

```typescript
const pdf = `data:application/pdf;base64,${readFileSync('report.pdf').toString('base64')}`;

await kernel.models.complete({
  messages: [{
    role: 'user',
    content: 'Summarize the report and the recording.',
    parts: [
      { type: 'text', text: 'Summarize the report and the recording.' },
      { type: 'file', url: pdf, filename: 'report.pdf' },
      { type: 'audio', url: `data:audio/mpeg;base64,${mp3}` },
      { type: 'image', url: 'https://example.com/chart.png' },
    ],
  }],
});
```

Images can be URLs or `data:` URIs for most providers (Ollama and Bedrock need `data:` URIs; Bedrock also takes `s3://` URIs). Audio and files need `data:` URIs, except PDF URLs for Claude, `gs://` and Files API URIs for Gemini and Vertex AI, and `s3://` URIs for Bedrock. A part a provider can't take raises an error that names the provider and the input.

### Embeddings

```typescript
const vector = await kernel.models.embed('machine learning');
const vectors = await kernel.models.embedMany(['first text', 'second text', 'third text']);
```

`embedMany()` batches as the API allows: up to 2048 texts per request for OpenAI and Azure, 100 for Gemini, 96 for Bedrock's Cohere models, and the whole list for Ollama. Titan and Vertex AI's gemini-embedding-001 take one text per request, so those are sent a few at a time.

### Listing Models

```typescript
const models = await kernel.models.listModels('openrouter');
// [{ id: 'anthropic/claude-sonnet-4', provider: 'openrouter', contextWindow: 200000,
//    capabilities: { vision: true, toolCalling: true, reasoning: true, ... } }, ...]

const everything = await kernel.models.listModels();   // every available provider
```

Each provider reports what its API includes: Gemini gives context windows and output limits; OpenRouter, Groq, Together, and Mistral add limits and capabilities; Bedrock lists foundation models and inference profiles; Vertex AI lists Google's Model Garden models; Ollama lists the models you've pulled. Without a provider, providers whose listing fails are left out.

## Agent Settings

Agents send the same settings with every model call they make:

```typescript
defineAgent({
  name: 'analyst',
  instructions: 'Answer with the figures you were asked for.',
  model: { provider: 'anthropic', model: 'claude-opus-5-5' },
  reasoning: { effort: 'high' },
  responseFormat: { type: 'json_schema', schema },
  promptCache: true,
  // ...
});
```

The framework's `defineAgent()` and the SDK's `app.agent()` take the same `reasoning`, `responseFormat`, and `promptCache` fields.

## Configuring Model Routing

### Default + fallback

```typescript
const kernel = new KernovaKernel({
  environment: 'development',
  models: {
    default: { provider: 'openai', model: 'gpt-4o' },
    fallback: { provider: 'anthropic', model: 'claude-sonnet-5-5' },
  },
});
```

If OpenAI fails (rate limit, outage), Kernova automatically tries Anthropic.

### Explicit provider creation

```typescript
import { createProvider } from '@kernova/core';

const deepseek = createProvider('deepseek');
const groq = createProvider('groq', { defaultModel: 'llama-3.1-8b-instant' });
const local = createProvider('ollama', { defaultModel: 'mistral' });
const bedrock = createProvider('bedrock', { options: { region: 'eu-west-1' } });
```

## Adding a Custom Provider

Any server that implements the OpenAI `/chat/completions` format works. Add to `Kernova.config.json`:

```json
{
  "providers": [
    {
      "id": "my-company-llm",
      "name": "Internal LLM",
      "adapter": "openai",
      "baseUrl": "https://llm.internal.company.com/v1",
      "apiKeyEnv": "INTERNAL_LLM_KEY",
      "defaultModel": "company-model-v2",
      "timeoutMs": 60000,
      "options": { "streamUsage": true, "reasoningFormat": "reasoning_effort" }
    }
  ]
}
```

**Zero code change.** Just config. `adapter` can also be `anthropic`, `gemini`, `azure`, `bedrock`, `vertex`, or `ollama`.

OpenAI-compatible options:

| Option | Description |
|--------|-------------|
| `reasoningFormat` | How the API takes reasoning settings: `reasoning_effort` (default), `openrouter`, `qwen`, `zai`, or `none` |
| `reasoningEfforts` | The effort levels the API accepts, e.g. `["low", "high", "max"]`; others are sent as the nearest one |
| `replayReasoning` | Send `reasoning_content` back during tool use |
| `omitTemperature` | Never send a temperature (APIs with fixed sampling) |
| `maxTokensField` | `max_tokens` (default) or `max_completion_tokens` |
| `defaultMaxTokens` | Output limit when a request doesn't set one (default 4096) |
| `streamUsage` | Ask for token usage when streaming |
| `embeddingModel` | Model for `/embeddings` |

Kimi K3 models have fixed sampling, so Kernova never sends them a temperature.

## Programmatic Custom Provider

```typescript
import { OpenAICompatibleProvider } from '@kernova/core';

const custom = new OpenAICompatibleProvider({
  id: 'my-custom',
  name: 'My Custom Provider',
  baseUrl: 'https://api.custom.com/v1',
  apiKey: process.env.CUSTOM_KEY || '',
  defaultModel: 'custom-model',
  headers: { 'X-Custom-Header': 'value' },
});
```

For an API with its own format, implement the `ModelProvider` interface (`complete()`, and optionally `stream()`, `embed()`, `embedMany()`, `listModels()`) and pass it in `providers`.

## Token Tracking

Every model call tracks token usage:

```typescript
const status = kernel.getStatus();
console.log(status.modelUsage);
// {
//   usage: { promptTokens: 5000, completionTokens: 2000, totalTokens: 7000, cachedTokens: 3000, reasoningTokens: 800 },
//   requestCount: 15,
// }
```

`cachedTokens` and `cacheWriteTokens` are included in `promptTokens`; `reasoningTokens` are included in `completionTokens`. This feeds into the [budget system](/guides/budgets/) for cost control.

## Streaming

Every built-in provider streams natively: server-sent events for OpenAI-compatible APIs, Anthropic, and Gemini; AWS's event stream format for Bedrock; and JSON lines for Ollama. A custom provider without `stream()` is streamed by splitting its complete answer into chunks:

```typescript
for await (const token of app.stream('Write a poem')) {
  process.stdout.write(token);
}
```

See the [Streaming guide](/guides/streaming/) for details.

## Checking Your Setup

`kernova doctor` checks every provider Kernova finds (including a local Ollama server) with a chat completion, a tool call, a stream, and an embedding, using the same provider classes as the kernel, so cloud sign-in is checked too. `kernova doctor --provider bedrock,vertex` checks only the providers you name, for example Bedrock with your AWS credentials.

## Best Practices

1. **Set multiple keys** — Gives you fallback when one provider has issues
2. **Use Ollama for development** — Free, fast, no API key hassles
3. **Use cheap models for simple tasks** — Not every question needs the largest model
4. **Monitor token usage** — Check `kernel.getStatus().modelUsage` regularly
5. **Test with different providers** — Ensure your prompts work across models
