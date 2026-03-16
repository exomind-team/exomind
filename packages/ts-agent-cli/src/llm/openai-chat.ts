/**
 * OpenAI-compatible chat completion client.
 *
 * Sends a system + user prompt to any OpenAI-compatible endpoint
 * and returns the assistant's response text.
 *
 * Configuration via options or environment variables:
 *   EXOMIND_LLM_BASE_URL  - API base URL (default: https://api.openai.com/v1)
 *   EXOMIND_LLM_API_KEY   - API key (required)
 *   EXOMIND_LLM_MODEL     - Model name (default: gpt-4o-mini)
 */

export interface ChatCompletionOptions {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  systemPrompt: string;
  userPrompt: string;
  timeout?: number;
}

function resolveBaseUrl(baseUrl?: string): string {
  const url = (baseUrl || process.env["EXOMIND_LLM_BASE_URL"] || "https://api.openai.com/v1").trim();
  return url.replace(/\/chat\/completions\/?$/, "").replace(/\/+$/, "");
}

function resolveApiKey(apiKey?: string): string {
  const key = (apiKey || process.env["EXOMIND_LLM_API_KEY"] || "").trim();
  if (!key) {
    throw new Error("LLM API key not configured. Set EXOMIND_LLM_API_KEY or pass apiKey option.");
  }
  return key;
}

function resolveModel(model?: string): string {
  return (model || process.env["EXOMIND_LLM_MODEL"] || "gpt-4o-mini").trim();
}

export async function chatCompletion(options: ChatCompletionOptions): Promise<string> {
  const baseUrl = resolveBaseUrl(options.baseUrl);
  const apiKey = resolveApiKey(options.apiKey);
  const model = resolveModel(options.model);
  const timeout = options.timeout ?? 120_000;

  const url = `${baseUrl}/chat/completions`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: options.systemPrompt },
        { role: "user", content: options.userPrompt },
      ],
    }),
    signal: AbortSignal.timeout(timeout),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`LLM API HTTP ${response.status}: ${body}`);
  }

  const data = await response.json() as {
    choices: Array<{ message: { content: string } }>;
  };

  return data.choices[0]?.message?.content ?? "";
}
