#!/usr/bin/env python
"""Validate the exomind-rt-agent-access skill structure."""

from __future__ import annotations

import re
import sys
from pathlib import Path


REQUIRED_FILES = [
    "SKILL.md",
    "references/index.md",
    "references/maintenance.md",
    "references/discovery-and-diagnostics.md",
    "references/eventlog.md",
    "references/tasks.md",
    "references/timeblocks.md",
]

METADATA_PATTERN = re.compile(
    r"^> 最后更新：`[^`]+` \| 更新者：`[^`]+` \| 更新内容概要：`[^`]+`$"
)


def fail(message: str) -> None:
    print(f"✗ {message}")
    raise SystemExit(1)


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def resolve_skill_root() -> Path:
    if len(sys.argv) > 1:
        return Path(sys.argv[1]).resolve()
    return Path(__file__).resolve().parents[1]


def validate_frontmatter(skill_md: str) -> None:
    match = re.match(r"^---\n(.*?)\n---", skill_md, re.DOTALL)
    if not match:
        fail("SKILL.md missing YAML frontmatter")

    frontmatter = match.group(1)
    if not re.search(r"^name:\s*exomind-rt-agent-access\s*$", frontmatter, re.MULTILINE):
        fail("SKILL.md frontmatter name must be exomind-rt-agent-access")

    desc_match = re.search(
        r"^description:\s*[\|>]?\s*\n?(.*)", frontmatter, re.MULTILINE | re.DOTALL
    )
    if not desc_match:
        fail("SKILL.md missing description in frontmatter")

    if "use when" not in desc_match.group(1).lower():
        fail("SKILL.md description must contain 'Use when'")


def validate_main_skill(root: Path, skill_md: str) -> None:
    line_count = skill_md.count("\n") + 1
    if line_count >= 500:
        fail(f"SKILL.md too long: {line_count} lines")

    required_mentions = [
        "references/index.md",
        "references/maintenance.md",
        "references/discovery-and-diagnostics.md",
        "references/eventlog.md",
        "references/tasks.md",
        "references/timeblocks.md",
    ]
    for mention in required_mentions:
        if mention not in skill_md:
            fail(f"SKILL.md missing reference to {mention}")


def validate_reference(path: Path) -> None:
    content = read_text(path)
    first_line = content.splitlines()[0] if content.splitlines() else ""
    if not METADATA_PATTERN.match(first_line):
        fail(f"{path.relative_to(path.parents[1])} missing maintenance metadata header")


def main() -> None:
    root = resolve_skill_root()

    for relative in REQUIRED_FILES:
        path = root / relative
        if not path.is_file():
            fail(f"missing required file: {relative}")

    skill_md = read_text(root / "SKILL.md")
    validate_frontmatter(skill_md)
    validate_main_skill(root, skill_md)

    for relative in REQUIRED_FILES[1:]:
        validate_reference(root / relative)

    print("✓ exomind-rt-agent-access valid")


if __name__ == "__main__":
    main()
