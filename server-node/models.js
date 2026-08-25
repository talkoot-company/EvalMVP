// Curated catalog of LLM deployments available for evals/rewrites.
//
// `value` is the Azure deployment NAME (what gets sent as the `model` field to
// chat.completions), `label` is the human name. Only deployments verified to work
// through the AzureOpenAI chat-completions client on the configured account belong
// here — Claude/DeepSeek/image deployments use a different API path and are omitted.
//
// This is the single source of truth: the backend validates against it and the
// frontend fetches it via GET /api/models to populate the model dropdowns.
export const DEFAULT_MODEL = "gpt-5";

// `api` marks how a deployment is reached: "openai" (default) uses the Azure
// OpenAI chat-completions client; "anthropic" uses the native Anthropic Messages
// API on the Foundry host (services.ai.azure.com/anthropic/v1/messages).
export const AVAILABLE_MODELS = [
  { value: "gpt-5", label: "GPT-5", note: "default" },
  { value: "gpt-5-mini", label: "GPT-5 mini" },
  { value: "gpt-5.4", label: "GPT-5.4" },
  { value: "gpt-5.6-terra", label: "GPT-5.6 Terra" },
  { value: "gpt-5.6-luna", label: "GPT-5.6 Luna" },
  { value: "gpt-4.1", label: "GPT-4.1" },
  { value: "o3", label: "o3 (reasoning)" },
  { value: "o3-mini", label: "o3-mini (reasoning)" },
  { value: "gpt-oss-120b", label: "GPT-OSS 120B" },
  { value: "claude-opus-4-8", label: "Claude Opus 4.8", api: "anthropic" },
  { value: "claude-opus-5", label: "Claude Opus 5", api: "anthropic" },
];

const ALLOWED = new Set(AVAILABLE_MODELS.map((m) => m.value));
const ANTHROPIC = new Set(AVAILABLE_MODELS.filter((m) => m.api === "anthropic").map((m) => m.value));

export function isAllowedModel(model) {
  return typeof model === "string" && ALLOWED.has(model);
}

// True for deployments served via the native Anthropic Messages API rather than
// the OpenAI chat-completions surface.
export function isAnthropicModel(model) {
  return ANTHROPIC.has(model);
}

// Return the first allowed candidate (override → suite default → …), else null so
// the caller can fall back to the env deployment (llmModel()).
export function pickModel(...candidates) {
  for (const c of candidates) {
    if (isAllowedModel(c)) return c;
  }
  return null;
}
