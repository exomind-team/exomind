import type { ReviewResult, TimeblockReviewResult } from "./index.js";

const META_LINE_PATTERNS = [
  /^\$[a-z0-9._-]+$/i,
  /^using\b.*\b(skill|skills|tool|tools|workflow|workflows)\b/i,
  /^i['’]?m using\b/i,
  /^i am using\b/i,
  /\busing-superpowers\b/i,
  /\bsystematic-debugging\b/i,
  /\btest-driven-development\b/i,
  /\bwriting-plans\b/i,
];

function isMetaLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) {
    return true;
  }
  if (trimmed === "```" || trimmed.startsWith("```")) {
    return true;
  }
  return META_LINE_PATTERNS.some((pattern) => pattern.test(trimmed));
}

export function sanitizeReviewField(value: string): string {
  const normalized = value.replace(/\r\n/g, "\n").trim();
  if (!normalized) {
    return normalized;
  }

  const lines = normalized.split("\n");
  let firstContentIndex = 0;
  while (firstContentIndex < lines.length && isMetaLine(lines[firstContentIndex] ?? "")) {
    firstContentIndex += 1;
  }

  const cleaned = lines
    .slice(firstContentIndex)
    .filter((line) => line.trim() !== "```")
    .join("\n")
    .trim();

  return cleaned || normalized;
}

export function sanitizeReviewResult(review: ReviewResult): ReviewResult {
  return {
    effective: sanitizeReviewField(review.effective),
    stuck: sanitizeReviewField(review.stuck),
    improve: sanitizeReviewField(review.improve),
    avoid: sanitizeReviewField(review.avoid),
  };
}

export function sanitizeTimeblockReviewResult(review: TimeblockReviewResult): TimeblockReviewResult {
  return {
    effective: sanitizeReviewField(review.effective),
    stuck: sanitizeReviewField(review.stuck),
    suggestion: sanitizeReviewField(review.suggestion),
  };
}
