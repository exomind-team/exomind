/**
 * Classifier Agent
 *
 * Listens for `user.input.text` signals from the RT, classifies the input
 * using LLM API, and publishes `input.classified` with structured results.
 *
 * Usage:
 *   bun run packages/ts-agent-cli/agents/classifier/index.ts
 *
 * Environment variables:
 *   EXOMIND_RT_URL        - RT address (default http://localhost:1949)
 *   CLASSIFIER_AGENT_ID   - Agent ID (default classifier)
 *   EXOMIND_LLM_BASE_URL  - OpenAI-compatible API base URL
 *   EXOMIND_LLM_API_KEY   - API key
 *   EXOMIND_LLM_MODEL     - Model name
 */

import { SignalClient } from "../../src/sse/signal-client.js";
import type { SignalEvent } from "../../src/sse/signal-types.js";
import { chatCompletion } from "../../src/llm/openai-chat.js";
import { CLASSIFIER_SYSTEM_PROMPT, CLASSIFIER_USER_PROMPT } from "./prompt.js";

const RT_URL = process.env["EXOMIND_RT_URL"] ?? "http://localhost:1949";
const AGENT_ID = process.env["CLASSIFIER_AGENT_ID"] ?? "classifier";

console.log(`[Classifier] starting — rt=${RT_URL} agent_id=${AGENT_ID}`);

const client = new SignalClient({
  rtUrl: RT_URL,
  agentId: AGENT_ID,
  source: "agent:classifier",
});

/**
 * Call LLM API to classify the input text.
 * Returns the parsed JSON classification result.
 */
async function classifyWithLLM(text: string): Promise<{
  type: string;
  items: unknown[];
} | null> {
  const userPrompt = CLASSIFIER_USER_PROMPT(text);

  try {
    const result = await chatCompletion({
      systemPrompt: CLASSIFIER_SYSTEM_PROMPT,
      userPrompt,
    });

    // Try to extract JSON from the response (LLM may add text around it)
    const trimmed = result.trim();
    const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error(
        `[Classifier] no JSON found in LLM response: ${trimmed.slice(0, 200)}`,
      );
      return null;
    }

    const parsed = JSON.parse(jsonMatch[0]);
    if (!parsed.type || !Array.isArray(parsed.items)) {
      console.error(
        `[Classifier] invalid classification structure: ${JSON.stringify(parsed).slice(0, 200)}`,
      );
      return null;
    }

    return parsed as { type: string; items: unknown[] };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[Classifier] LLM API call failed: ${msg}`);
    return null;
  }
}

async function handleSignal(event: SignalEvent): Promise<void> {
  console.log(
    `[Classifier] received signal: topic=${event.topic} id=${event.id}`,
  );

  // Extract the text from the payload
  const payload = event.payload as Record<string, unknown> | null;
  const text =
    typeof payload === "object" && payload !== null
      ? (payload.text as string | undefined)
      : undefined;

  if (!text || !text.trim()) {
    console.warn(
      `[Classifier] no text in payload for event ${event.id}, skipping`,
    );
    return;
  }

  console.log(`[Classifier] classifying: "${text.slice(0, 100)}..."`);

  const classification = await classifyWithLLM(text);
  if (!classification) {
    console.error(`[Classifier] classification failed for event ${event.id}`);
    return;
  }

  console.log(
    `[Classifier] classified as: type=${classification.type}, items=${classification.items.length}`,
  );

  try {
    const response = await client.publish({
      topic: "input.classified",
      payload: {
        ...classification,
        source_text: text,
      },
      trace_id: event.trace_id,
      source: "agent:classifier",
    });

    console.log(
      `[Classifier] published input.classified: event_id=${response.event_id}`,
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[Classifier] publish failed: ${msg}`);
  }
}

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("[Classifier] shutting down...");
  client.stop();
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("[Classifier] shutting down...");
  client.stop();
  process.exit(0);
});

// Start listening
await client.listenWith(handleSignal);
