# Comment Policy And Templates

## Comment Types

- Normal review comment
- No-issue confirmation comment
- Needs-human-test comment
- Inline quoted reply within the same comment

## Normal Review Template

Use `[Codex Reviewer]` as the prefix.

Suggested structure:

1. Conclusion
2. Findings
3. Validation
4. Next step

## No-Issue Template

Use a short confirmation when no problems are found.

Example:

```text
[Codex Reviewer] 已审阅最新变更，未发现问题。
```

## Needs-Human-Test Template

Use `[Codex Reviewer] ❤️ 需要人类测试` as the prefix.

The comment must include:

- why machine review is insufficient
- what human should test
- how to test it
- what counts as pass or fail
- confirmation that label `🙋needs-human-test` was added

## Reply Style

If the comment needs to answer multiple earlier remarks, keep all replies in one comment.

Quote format:

```text
> 原文关键句
```

Then provide:

- analysis
- validation
- next step

## Readback Validation

After posting a comment, read it back and check:

- prefix is valid
- no suspicious long question-mark sequence
- no unescaped `\n`
- language matches the PR language

If the comment fails validation:

- write a corrected draft under `./temp/`
- edit the comment via `gh api`
- validate again

## Language Policy

Use the PR's primary language.

Recommended signal order:

- PR title language
- PR body language
- existing discussion language

Do not switch language mid-comment without reason.

## Label Policy

Add `🙋needs-human-test` only when machine review cannot safely validate the required behavior.

Do not add that label for purely speculative concerns.

## Approval And Merge Gates

### Approve

All must be true:

- no current blocking findings
- previously raised findings are fixed
- CI passes
- local verification passes

### Merge

All must be true:

- approve conditions already satisfied
- every review item has a verification result
- no pending work remains
- no `🙋needs-human-test` label remains active
