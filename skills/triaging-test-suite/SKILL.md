---
name: triaging-test-suite
description: "Use when the full test suite has 5+ failures NOT directly caused by your current changes. Typical triggers: inheriting a red CI, post-merge breakage, pre-existing failures discovered during validation. NOT when 1-2 failures tied to your own edits (use systematic-debugging). NOT when writing new tests (use test-driven-development)."
---

# Test Suite Triage

Batch-repair a broken test suite by categorizing failures by root cause,
then fixing each category in parallel.

## Iron Rule

**Categorize BEFORE fixing.** Fixing tests one-by-one wastes time and misses
patterns. 30 failures often collapse into 5-6 root causes.

## Phase 1: Collect

Run the full suite once. Extract the complete failure list.

```bash
# Example for vitest (adapt to your test runner: jest, pytest, cargo test, etc.)
npx vitest run 2>&1 | tee /tmp/test-full.log

# Extract failure summary (strip ANSI codes)
grep "FAIL\|× " /tmp/test-full.log | sed 's/\x1b\[[0-9;]*m//g'
```

Record three things per failure: **file name**, **error type**, **first line of error message**.

Do NOT attempt any fixes yet.

## Phase 2: Categorize

Group failures by **error signature**, not by file name.
See [references/root-cause-taxonomy.md](references/root-cause-taxonomy.md) for
the common pattern catalog.

Output a table:

```
| Category | Count | Root Cause (one sentence) | Fix Pattern |
```

**Quality check:** If any category has only 1 failure AND the error is unique,
investigate whether it's actually a variant of another category.

## Phase 3: Dispatch

For each category, create one fix task. Categories touch disjoint file sets,
so they can run in parallel (use subagents, background tasks, or sequential
batch — whichever the environment supports).

Each task prompt must include:
1. Root cause (one sentence)
2. Exact file list
3. Fix pattern (what to change and why)
4. Verification command (run all files in the category together)

## Phase 4: Verify

After all tasks complete:

1. Type check (e.g. `tsc --noEmit`, `cargo check`, `mypy`)
2. Full test suite run — fresh, not cached
3. Compare before/after: failed count, passed count, skipped count
4. Any new `skip` must have a comment explaining why

**Do not claim success without running the full suite.**

## Decision Rules

| Situation | Action |
|-----------|--------|
| Test imports deleted module | Delete test OR skip + stub imports |
| Mock missing a method | Add the method to the mock |
| Hardcoded constant changed | Import the constant, don't hardcode |
| Partial mock breaks on new exports | Use importOriginal + spread pattern |
| Test asserts source code text | Update assertion; prefer behavioral test |
| Component behavior intentionally changed | Update test to match new behavior |
| Feature not yet implemented | Skip with comment explaining why |

## Anti-Patterns

- Fixing tests one by one without categorizing first
- Running full suite after every single fix (run per-category, full suite at end)
- Skipping tests that should be fixed (skip only for unimplemented features)
- Fixing production code to make old tests pass
- Hardcoding new magic numbers instead of importing constants
