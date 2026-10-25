from app.repo_utils import (
    apply_edits, highest_severity, normalize_severity, number_lines, parse_repo_url,
    select_files, skip_reason, slugify,
)


class TestParseRepoUrl:
    def test_full_url(self):
        assert parse_repo_url("https://github.com/vercel/next.js") == ("vercel", "next.js")

    def test_url_with_git_suffix_and_path(self):
        assert parse_repo_url("scan https://github.com/psf/requests.git please") == ("psf", "requests")
        assert parse_repo_url("https://github.com/psf/requests/tree/main/src") == ("psf", "requests")

    def test_short_form(self):
        assert parse_repo_url("octocat/Hello-World") == ("octocat", "Hello-World")

    def test_rejects_garbage(self):
        assert parse_repo_url("not a repo") is None
        assert parse_repo_url("https://gitlab.com/a/b") is None


class TestSeverity:
    def test_normalize(self):
        assert normalize_severity("**High**") == "high"
        assert normalize_severity("CRITICAL") == "critical"
        assert normalize_severity("weird") == "medium"

    def test_highest(self):
        assert highest_severity(["low", "high", "medium"]) == "high"


class TestFileSelection:
    def test_skip_reasons(self):
        assert skip_reason("package-lock.json", 10, 1000) == "lockfile"
        assert skip_reason("node_modules/x/index.js", 10, 1000) == "generated or vendored directory"
        assert skip_reason("static/app.min.js", 10, 1000) == "minified file"
        assert skip_reason("README.md", 10, 1000) == "not a supported code file"
        assert skip_reason("src/big.py", 5000, 1000).startswith("too large")
        assert skip_reason("src/ok.py", 10, 1000) is None

    def test_select_files_filters_and_caps(self):
        tree = [{"path": f"src/f{i}.py", "size": 10} for i in range(5)] + [
            {"path": "yarn.lock", "size": 10},
            {"path": "docs/readme.md", "size": 10},
            {"path": "lib/x.js", "size": 10},
        ]
        selected, skipped, overflow = select_files(tree, "src/", max_files=3, max_chars=1000)
        assert [f["path"] for f in selected] == ["src/f0.py", "src/f1.py", "src/f2.py"]
        assert overflow == 2
        assert skipped == []

        selected, skipped, _ = select_files(tree, "all", max_files=50, max_chars=1000)
        assert len(selected) == 6
        assert skipped == [{"path": "yarn.lock", "reason": "lockfile"}]


class TestApplyEdits:
    SOURCE = "def avg(xs):\n    return sum(xs) / len(xs)\n\n\ndef first(xs):\n    return xs[0]\n" * 10

    def test_applies_unique_match(self):
        src = "a = 1\nb = 2\n"
        out, applied, rejected = apply_edits(src, [{"find": "b = 2", "replace": "b = 3"}])
        assert out == "a = 1\nb = 3\n" and applied == 1 and rejected == []

    def test_rejects_missing_and_ambiguous(self):
        out, applied, rejected = apply_edits(self.SOURCE, [
            {"find": "nope", "replace": "x"},
            {"find": "return xs[0]", "replace": "return xs[0] if xs else None"},
        ])
        assert out == self.SOURCE and applied == 0
        assert "not found" in rejected[0] and "matches 10 places" in rejected[1]

    def test_rejects_edit_that_replaces_most_of_file(self):
        _, applied, rejected = apply_edits(self.SOURCE, [{"find": self.SOURCE[:-5], "replace": ""}])
        assert applied == 0 and rejected == ["edit would replace most of the file"]


def test_number_lines_and_slugify():
    assert number_lines("a\nb") == "1 | a\n2 | b"
    assert slugify("src/App Utils.tsx") == "src-app-utils-tsx"
    assert slugify("!!!") == "fix"
