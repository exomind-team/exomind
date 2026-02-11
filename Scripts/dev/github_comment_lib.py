import re
from pathlib import Path
from typing import Dict, Optional

_COMMENT_PATTERNS = (
    re.compile(r"#issuecomment-(\d+)$", re.IGNORECASE),
    re.compile(r"issuecomment-(\d+)$", re.IGNORECASE),
    re.compile(r"^(\d+)$"),
)

_GITHUB_REF_PATTERN = re.compile(
    r"^https?://github\.com/([^/]+/[^/]+)/(issues|pull)/(\d+)(?:#issuecomment-(\d+))?/?$",
    re.IGNORECASE,
)

_HTTPS_REMOTE_PATTERN = re.compile(
    r"^https?://github\.com/([^/]+)/([^/]+?)(?:\.git)?$",
    re.IGNORECASE,
)

_SSH_REMOTE_PATTERN = re.compile(
    r"^git@github\.com:([^/]+)/([^/]+?)(?:\.git)?$",
    re.IGNORECASE,
)


def parse_comment_id(locator: str) -> str:
    if not locator or not isinstance(locator, str):
        raise ValueError("Comment id locator is required.")

    value = locator.strip()
    for pattern in _COMMENT_PATTERNS:
        match = pattern.search(value)
        if match:
            return match.group(1)

    raise ValueError(f"Unable to parse comment id from locator: {locator}")


def parse_github_ref(ref: str) -> Dict[str, object]:
    if not ref or not isinstance(ref, str):
        raise ValueError("GitHub ref is required.")

    match = _GITHUB_REF_PATTERN.match(ref.strip())
    if not match:
        raise ValueError(f"Invalid GitHub issue/pr ref: {ref}")

    comment_id: Optional[str] = match.group(4)
    return {
        "repo": match.group(1),
        "type": "pr" if match.group(2).lower() == "pull" else "issue",
        "number": int(match.group(3)),
        "comment_id": comment_id,
    }


def resolve_mode(requested_mode: Optional[str], comment_id: Optional[str]) -> str:
    if requested_mode:
        mode = requested_mode.strip().lower()
        if mode not in {"create", "append", "replace"}:
            raise ValueError(
                f"Invalid mode: {requested_mode}. Expected create|append|replace."
            )
        return mode

    return "append" if comment_id else "create"


def build_appended_body(existing_body: str, incoming_body: str) -> str:
    existing = existing_body or ""
    incoming = incoming_body or ""

    if not existing.strip():
        return incoming
    return f"{existing}\n\n{incoming}"


def read_body_input(file_path: Optional[str], body_text: Optional[str]) -> str:
    if file_path and body_text:
        raise ValueError("Use either --file or --body, not both.")
    if not file_path and not body_text:
        raise ValueError("One of --file or --body is required.")

    if file_path:
        return Path(file_path).read_text(encoding="utf-8")
    return body_text or ""


def parse_repo_from_remote_url(remote_url: str) -> str:
    if not remote_url:
        raise ValueError("Remote URL is empty.")

    value = remote_url.strip()
    https_match = _HTTPS_REMOTE_PATTERN.match(value)
    if https_match:
        return f"{https_match.group(1)}/{https_match.group(2)}"

    ssh_match = _SSH_REMOTE_PATTERN.match(value)
    if ssh_match:
        return f"{ssh_match.group(1)}/{ssh_match.group(2)}"

    raise ValueError(f"Unable to parse GitHub repo from remote URL: {remote_url}")
