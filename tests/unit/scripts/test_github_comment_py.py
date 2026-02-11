import pathlib
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[3]
SCRIPTS_DEV = ROOT / "Scripts" / "dev"
if str(SCRIPTS_DEV) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DEV))

from github_comment_lib import (
    build_appended_body,
    parse_comment_id,
    parse_github_ref,
    parse_repo_from_remote_url,
    resolve_mode,
)


class GithubCommentLibTests(unittest.TestCase):
    def test_parse_comment_id_hash(self) -> None:
        self.assertEqual(parse_comment_id("#issuecomment-3883010944"), "3883010944")

    def test_parse_comment_id_url(self) -> None:
        locator = "https://github.com/exomind-team/exomind/issues/93#issuecomment-3883010944"
        self.assertEqual(parse_comment_id(locator), "3883010944")

    def test_parse_comment_id_raw(self) -> None:
        self.assertEqual(parse_comment_id("3883010944"), "3883010944")

    def test_parse_comment_id_invalid(self) -> None:
        with self.assertRaisesRegex(ValueError, "comment id"):
            parse_comment_id("#discussion_r123")

    def test_parse_github_ref_issue_with_comment(self) -> None:
        parsed = parse_github_ref(
            "https://github.com/exomind-team/exomind/issues/93#issuecomment-3883010944"
        )
        self.assertEqual(
            parsed,
            {
                "repo": "exomind-team/exomind",
                "type": "issue",
                "number": 93,
                "comment_id": "3883010944",
            },
        )

    def test_parse_github_ref_pr(self) -> None:
        parsed = parse_github_ref("https://github.com/exomind-team/exomind/pull/89")
        self.assertEqual(
            parsed,
            {
                "repo": "exomind-team/exomind",
                "type": "pr",
                "number": 89,
                "comment_id": None,
            },
        )

    def test_resolve_mode_default_create(self) -> None:
        self.assertEqual(resolve_mode(None, None), "create")

    def test_resolve_mode_default_append(self) -> None:
        self.assertEqual(resolve_mode(None, "3883010944"), "append")

    def test_resolve_mode_explicit_replace(self) -> None:
        self.assertEqual(resolve_mode("replace", "3883010944"), "replace")

    def test_build_appended_body(self) -> None:
        self.assertEqual(build_appended_body("old", "new"), "old\n\nnew")
        self.assertEqual(build_appended_body("", "new"), "new")

    def test_parse_repo_from_remote(self) -> None:
        self.assertEqual(
            parse_repo_from_remote_url("https://github.com/exomind-team/exomind.git"),
            "exomind-team/exomind",
        )
        self.assertEqual(
            parse_repo_from_remote_url("git@github.com:exomind-team/exomind.git"),
            "exomind-team/exomind",
        )

    def test_parse_repo_from_remote_supports_dotted_repo_name(self) -> None:
        self.assertEqual(
            parse_repo_from_remote_url("https://github.com/org/my.repo.git"),
            "org/my.repo",
        )
        self.assertEqual(
            parse_repo_from_remote_url("git@github.com:org/my.repo.git"),
            "org/my.repo",
        )


if __name__ == "__main__":
    unittest.main()
