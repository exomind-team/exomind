#!/usr/bin/env python3

import argparse
import json
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Optional

from github_comment_lib import (
    build_appended_body,
    parse_comment_id,
    parse_github_ref,
    parse_repo_from_remote_url,
    read_body_input,
    resolve_mode,
)


def run_command(args: list[str]) -> str:
    proc = subprocess.run(args, capture_output=True, text=True, check=False)
    if proc.returncode != 0:
        err = proc.stderr.strip() or proc.stdout.strip() or "Unknown command error"
        raise RuntimeError(err)
    return proc.stdout.strip()


def run_gh(args: list[str]) -> str:
    return run_command(["gh", *args])


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Create/append/replace GitHub issue or PR comments with markdown input."
    )
    parser.add_argument("--repo", help="GitHub repo owner/name. Auto-detect when omitted.")
    parser.add_argument("--type", choices=["issue", "pr"], help="Target type.")
    parser.add_argument("--number", type=int, help="Issue/PR number")
    parser.add_argument(
        "--comment",
        help="Comment locator: #issuecomment-123 | issuecomment-123 | full URL | 123",
    )
    parser.add_argument("--mode", choices=["create", "append", "replace"])
    parser.add_argument("--file", help="Markdown file path")
    parser.add_argument("--body", help="Markdown body text")
    parser.add_argument("--ref", help="GitHub issue/pr URL (optionally with #issuecomment-xxx)")
    parser.add_argument("--dry-run", action="store_true", help="Preview resolved operation")
    return parser.parse_args()


def ensure_repo(explicit_repo: Optional[str]) -> str:
    if explicit_repo:
        return explicit_repo

    try:
        from_gh = run_gh(["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"])
        if from_gh:
            return from_gh
    except RuntimeError:
        pass

    remote_url = run_command(["git", "config", "--get", "remote.origin.url"])
    return parse_repo_from_remote_url(remote_url)


def write_temp_markdown(content: str) -> Path:
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", suffix=".md", delete=False) as tmp:
        tmp.write(content)
        return Path(tmp.name)


def create_comment(repo: str, number: int, body: str) -> str:
    temp_path = write_temp_markdown(body)
    try:
        return run_gh(
            [
                "api",
                f"repos/{repo}/issues/{number}/comments",
                "-X",
                "POST",
                "-F",
                f"body=@{temp_path}",
                "--jq",
                ".html_url",
            ]
        )
    finally:
        temp_path.unlink(missing_ok=True)


def replace_comment(repo: str, comment_id: str, body: str) -> str:
    temp_path = write_temp_markdown(body)
    try:
        return run_gh(
            [
                "api",
                f"repos/{repo}/issues/comments/{comment_id}",
                "-X",
                "PATCH",
                "-F",
                f"body=@{temp_path}",
                "--jq",
                ".html_url",
            ]
        )
    finally:
        temp_path.unlink(missing_ok=True)


def fetch_comment_body(repo: str, comment_id: str) -> str:
    return run_gh(["api", f"repos/{repo}/issues/comments/{comment_id}", "--jq", ".body"])


def main() -> int:
    args = parse_args()

    parsed_ref = parse_github_ref(args.ref) if args.ref else None

    repo = ensure_repo(args.repo or (parsed_ref["repo"] if parsed_ref else None))
    target_type = args.type or (parsed_ref["type"] if parsed_ref else "issue")

    number = args.number if args.number is not None else (parsed_ref["number"] if parsed_ref else None)
    if not isinstance(number, int) or number <= 0:
        raise ValueError("Issue/PR number is required and must be positive.")

    comment_id: Optional[str] = None
    if args.comment:
        comment_id = parse_comment_id(args.comment)
    elif parsed_ref and parsed_ref.get("comment_id"):
        comment_id = parse_comment_id(str(parsed_ref["comment_id"]))

    mode = resolve_mode(args.mode, comment_id)
    body = read_body_input(args.file, args.body)
    if not body.strip():
        raise ValueError("Input body is empty.")

    if mode in {"append", "replace"} and not comment_id:
        raise ValueError(f"Mode {mode} requires --comment or --ref with #issuecomment-...")

    if args.dry_run:
        preview = {
            "repo": repo,
            "type": target_type,
            "number": number,
            "mode": mode,
            "commentId": comment_id,
            "bodyPreview": body[:160],
        }
        print(json.dumps(preview, ensure_ascii=False, indent=2))
        return 0

    if mode == "create":
        print(create_comment(repo, number, body))
        return 0

    if mode == "replace":
        print(replace_comment(repo, comment_id or "", body))
        return 0

    existing = fetch_comment_body(repo, comment_id or "")
    merged = build_appended_body(existing, body)
    print(replace_comment(repo, comment_id or "", merged))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # pylint: disable=broad-except
        print(f"[gh-comment] {exc}", file=sys.stderr)
        raise SystemExit(1)
