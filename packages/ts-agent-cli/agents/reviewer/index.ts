/**
 * Reviewer Agent
 *
 * Listens for `session.end` signals from the RT, collects the day's events,
 * calls Claude CLI for a structured review, and publishes `review.completed`.
 *
 * Usage:
 *   bun run packages/ts-agent-cli/agents/reviewer/index.ts
 *
 * Environment variables:
 *   EXOMIND_RT_URL      - RT address (default http://localhost:1949)
 *   REVIEWER_AGENT_ID   - Agent ID (default reviewer)
 */

import { execSync } from "node:child_process";
import { SignalClient } from "../../src/sse/signal-client.js";
import type { SignalEvent } from "../../src/sse/signal-types.js";
import { REVIEWER_SYSTEM_PROMPT, REVIEWER_USER_PROMPT } from "./prompt.js";

const RT_URL = process.env["EXOMIND_RT_URL"] ?? "http://localhost:1949";
const AGENT_ID = process.env["REVIEWER_AGENT_ID"] ?? "reviewer";

console.log(`[Reviewer] starting — rt=${RT_URL} agent_id=${AGENT_ID}`);

const client = new SignalClient({
  rtUrl: RT_URL,
  agentId: AGENT_ID,
  source: "agent:reviewer",
});

export interface ReviewResult {
  effective: string;
  stuck: string;
  improve: string;
  avoid: string;
}

export interface EventEntry {
  text: string;
  ts: number;
}

/**
 * Call Claude CLI to produce a structured review from the event log.
 */
function reviewWithClaude(events: EventEntry[]): ReviewResult | null {
  const eventsText = JSON.stringify(events, null, 2);
  const userPrompt = REVIEWER_USER_PROMPT(eventsText);

  try {
    const result = execSync(
      `claude --print --system-prompt "${REVIEWER_SYSTEM_PROMPT.replace(/"/g, '\\"')}" "${userPrompt.replace(/"/g, '\\"')}"`,
      {
        encoding: "utf-8",
        timeout: 120_000,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );

    // Extract JSON from the response
    const trimmed = result.trim();
    const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error(
        `[Reviewer] no JSON found in Claude response: ${trimmed.slice(0, 200)}`,
      );
      return null;
    }

    const parsed = JSON.parse(jsonMatch[0]);
    if (
      typeof parsed.effective !== "string" ||
      typeof parsed.stuck !== "string" ||
      typeof parsed.improve !== "string" ||
      typeof parsed.avoid !== "string"
    ) {
      console.error(
        `[Reviewer] invalid review structure: ${JSON.stringify(parsed).slice(0, 200)}`,
      );
      return null;
    }

    return parsed as ReviewResult;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[Reviewer] Claude CLI call failed: ${msg}`);
    return null;
  }
}

async function handleSignal(event: SignalEvent): Promise<void> {
  if (event.topic !== "session.end") {
    return;
  }

  console.log(
    `[Reviewer] received session.end: id=${event.id}`,
  );

  // Extract events from payload
  const payload = event.payload as Record<string, unknown> | null;
  const events: EventEntry[] =
    typeof payload === "object" &&
    payload !== null &&
    Array.isArray(payload.events)
      ? (payload.events as EventEntry[])
      : [];

  if (events.length === 0) {
    console.warn(`[Reviewer] no events in session.end payload, skipping`);
    return;
  }

  console.log(`[Reviewer] reviewing ${events.length} events...`);

  const review = reviewWithClaude(events);
  if (!review) {
    console.error(`[Reviewer] review generation failed for event ${event.id}`);
    return;
  }

  console.log(`[Reviewer] review completed`);

  try {
    const response = await client.publish({
      topic: "review.completed",
      payload: review,
      trace_id: event.trace_id,
      source: "agent:reviewer",
    });

    console.log(
      `[Reviewer] published review.completed: event_id=${response.event_id}`,
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[Reviewer] publish failed: ${msg}`);
  }
}

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("[Reviewer] shutting down...");
  client.stop();
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("[Reviewer] shutting down...");
  client.stop();
  process.exit(0);
});

// Start listening
await client.listenWith(handleSignal);
