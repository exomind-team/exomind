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
} from "../../agents/reviewer/prompt.js";

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
});
