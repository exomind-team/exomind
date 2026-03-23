/**
 * Reviewer Agent 单元测试
 *
 * Tests the prompt module and signal handling logic.
 * Note: Claude CLI integration is not tested here (requires live CLI).
 */

import { describe, it, expect } from "vitest";
import {
  REVIEWER_SYSTEM_PROMPT,
  REVIEWER_USER_PROMPT,
  TIMEBLOCK_REVIEWER_SYSTEM_PROMPT,
} from "../../agents/reviewer/prompt.js";
import {
  sanitizeReviewField,
  sanitizeTimeblockReviewResult,
} from "../../agents/reviewer/review-output.js";
import {
  buildTimeblockReviewKey,
  decideTimeblockReview,
  TIMEBLOCK_REVIEW_STARTUP_GRACE_MS,
} from "../../agents/reviewer/timeblock-review-guard.js";

describe("Reviewer Agent Prompts", () => {
  describe("REVIEWER_SYSTEM_PROMPT", () => {
    it("should be a non-empty string", () => {
      expect(typeof REVIEWER_SYSTEM_PROMPT).toBe("string");
      expect(REVIEWER_SYSTEM_PROMPT.length).toBeGreaterThan(0);
    });

    it("should mention JSON output format", () => {
      expect(REVIEWER_SYSTEM_PROMPT).toContain("JSON");
    });

    it("should mention four review fields", () => {
      expect(REVIEWER_SYSTEM_PROMPT).toContain("effective");
      expect(REVIEWER_SYSTEM_PROMPT).toContain("stuck");
      expect(REVIEWER_SYSTEM_PROMPT).toContain("improve");
      expect(REVIEWER_SYSTEM_PROMPT).toContain("avoid");
    });
  });

  describe("REVIEWER_USER_PROMPT", () => {
    it("should include the events text in the prompt", () => {
      const events = JSON.stringify([
        { text: "woke up at 7am", ts: 1700000000000 },
        { text: "worked on project", ts: 1700003600000 },
      ]);

      const prompt = REVIEWER_USER_PROMPT(events);

      expect(prompt).toContain("woke up at 7am");
      expect(prompt).toContain("worked on project");
    });

    it("should handle empty events array", () => {
      const prompt = REVIEWER_USER_PROMPT("[]");
      expect(prompt).toContain("[]");
    });
  });

  describe("TIMEBLOCK reviewer hardening（时间块 reviewer 加固）", () => {
    it("should explicitly forbid skill and tool chatter in timeblock prompt", () => {
      expect(TIMEBLOCK_REVIEWER_SYSTEM_PROMPT).toContain("Never mention internal skills");
      expect(TIMEBLOCK_REVIEWER_SYSTEM_PROMPT).toContain("using-superpowers");
    });

    it("sanitizeReviewField removes leaked skill preamble（清理技能前言泄漏）", () => {
      expect(
        sanitizeReviewField(
          "Using using-superpowers to inspect the task.\n\n这次专注节奏很稳，推进清晰。",
        ),
      ).toBe("这次专注节奏很稳，推进清晰。");
    });

    it("sanitizeTimeblockReviewResult cleans every output field（清理全部时间块字段）", () => {
      expect(
        sanitizeTimeblockReviewResult({
          effective: "Using using-superpowers to inspect.\n完成了核心任务。",
          stuck: "$using-superpowers\nNothing noted",
          suggestion: "I’m using systematic-debugging.\n下次先拆小任务再开始。",
        }),
      ).toEqual({
        effective: "完成了核心任务。",
        stuck: "Nothing noted",
        suggestion: "下次先拆小任务再开始。",
      });
    });

    it("buildTimeblockReviewKey prefers trace_id（优先使用 trace_id 作为去重键）", () => {
      expect(
        buildTimeblockReviewKey(
          { id: "evt-1", trace_id: "trace-123" },
          {
            block: {
              id: "block-1",
              name: "deep work",
              startTime: 1000,
              endTime: 2000,
            },
          },
        ),
      ).toBe("trace:trace-123");
    });

    it("decideTimeblockReview skips stale historical blocks（跳过启动前的旧时间块）", () => {
      const agentStartedAt = 10_000;
      expect(
        decideTimeblockReview({
          event: { id: "evt-old", trace_id: undefined },
          payload: {
            block: {
              id: "block-old",
              name: "old block",
              startTime: 0,
              endTime: agentStartedAt - TIMEBLOCK_REVIEW_STARTUP_GRACE_MS - 1,
            },
          },
          processedKeys: new Set<string>(),
          agentStartedAt,
        }),
      ).toEqual({
        key: `timeblock:block-old:${agentStartedAt - TIMEBLOCK_REVIEW_STARTUP_GRACE_MS - 1}`,
        skip: true,
        reason: "stale_before_agent_start",
      });
    });

    it("decideTimeblockReview skips duplicate keys（跳过重复时间块反馈）", () => {
      const processedKeys = new Set<string>(["trace:trace-dup"]);
      expect(
        decideTimeblockReview({
          event: { id: "evt-dup", trace_id: "trace-dup" },
          payload: {
            block: {
              id: "block-dup",
              name: "dup block",
              startTime: 1000,
              endTime: 2000,
            },
          },
          processedKeys,
          agentStartedAt: 1500,
        }),
      ).toEqual({
        key: "trace:trace-dup",
        skip: true,
        reason: "duplicate",
      });
    });

    it("decideTimeblockReview keeps fresh block after startup（保留启动后的新时间块）", () => {
      expect(
        decideTimeblockReview({
          event: { id: "evt-fresh", trace_id: undefined },
          payload: {
            block: {
              id: "block-fresh",
              name: "fresh block",
              startTime: 1000,
              endTime: 10_100,
            },
          },
          processedKeys: new Set<string>(),
          agentStartedAt: 10_000,
        }),
      ).toEqual({
        key: "timeblock:block-fresh:10100",
        skip: false,
        reason: "fresh",
      });
    });
  });
});
