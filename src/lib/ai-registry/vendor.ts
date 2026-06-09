/**
 * Infer the vendor/provider identifier from a base URL.
 *
 * Used by both the AI Registry settings UI and the LLM config bridge
 * to normalize base URLs into `openai` / `anthropic` etc.
 */
export function inferVendorFromBaseUrl(baseUrl: string): string {
  const normalized = baseUrl.toLowerCase();
  if (normalized.includes("anthropic")) {
    return "anthropic";
  }
  if (normalized.includes("openrouter")) {
    return "openrouter";
  }
  if (normalized.includes("google")) {
    return "google";
  }
  return "openai";
}
