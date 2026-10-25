"""Pure helpers with no network access, so they are easy to unit test."""

import re
from pathlib import PurePosixPath

SEVERITIES = ("critical", "high", "medium", "low")
SEVERITY_RANK = {s: i for i, s in enumerate(SEVERITIES)}
SEVERITY_EMOJI = {"critical": "🔴", "high": "🟠", "medium": "🟡", "low": "🔵"}

CODE_EXTENSIONS = {
    ".py", ".js", ".mjs", ".cjs", ".ts", ".jsx", ".tsx", ".go", ".rb", ".java",
    ".kt", ".swift", ".php", ".cs", ".rs", ".cpp", ".cc", ".c", ".h", ".hpp",
    ".sh", ".json", ".toml", ".yaml", ".yml",
}

# Generated files: reviewing them wastes tokens and "fixing" them breaks builds.
LOCKFILES = {
    "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "poetry.lock", "Pipfile.lock",
    "Cargo.lock", "composer.lock", "Gemfile.lock", "go.sum", "uv.lock", "bun.lockb",
}
IGNORED_DIRS = {
    "node_modules", "vendor", "dist", "build", ".git", ".next", "out",
    "__pycache__", ".venv", "venv", "coverage", "third_party",
}

_OWNER = r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})"
_REPO = r"[A-Za-z0-9._-]+"
_URL_RE = re.compile(rf"(?:https?://)?(?:www\.)?github\.com/({_OWNER})/({_REPO})", re.IGNORECASE)
_SHORT_RE = re.compile(rf"^\s*({_OWNER})/({_REPO})\s*$")


def parse_repo_url(text: str) -> tuple[str, str] | None:
    """Return (owner, repo) from a GitHub URL or an `owner/repo` string."""
    match = _URL_RE.search(text) or _SHORT_RE.match(text)
    if not match:
        return None
    owner, repo = match.group(1), match.group(2)
    repo = re.sub(r"\.git$", "", repo).rstrip(".")
    if not repo or repo in {".", ".."}:
        return None
    return owner, repo


def normalize_severity(value: str) -> str:
    cleaned = re.sub(r"[^a-z]", "", (value or "").lower())
    return cleaned if cleaned in SEVERITY_RANK else "medium"


def highest_severity(severities: list[str]) -> str:
    return min(severities, key=lambda s: SEVERITY_RANK.get(s, 99), default="low")


def skip_reason(path: str, size: int | None, max_chars: int) -> str | None:
    """Why a file should not be analyzed, or None if it should be."""
    p = PurePosixPath(path)
    if p.name in LOCKFILES:
        return "lockfile"
    if any(part in IGNORED_DIRS for part in p.parts[:-1]):
        return "generated or vendored directory"
    if p.name.endswith((".min.js", ".min.css", ".bundle.js")):
        return "minified file"
    if p.suffix.lower() not in CODE_EXTENSIONS:
        return "not a supported code file"
    if size is not None and size > max_chars:
        return f"too large ({size:,} bytes, limit {max_chars:,})"
    return None


def select_files(
    tree: list[dict], file_filter: str, max_files: int, max_chars: int
) -> tuple[list[dict], list[dict], int]:
    """Pick files to analyze.

    Returns (selected, skipped, overflow) where `skipped` lists matching files
    left out for a reason and `overflow` counts eligible files beyond max_files.
    """
    needle = "" if file_filter.strip().lower() in {"", "all", "*"} else file_filter.strip().lower()
    selected, skipped = [], []
    for item in sorted(tree, key=lambda t: t["path"]):
        if needle and needle not in item["path"].lower():
            continue
        reason = skip_reason(item["path"], item.get("size"), max_chars)
        if reason == "not a supported code file":
            continue  # Not worth reporting: images, docs, etc.
        if reason:
            skipped.append({"path": item["path"], "reason": reason})
        else:
            selected.append(item)
    overflow = max(0, len(selected) - max_files)
    return selected[:max_files], skipped, overflow


def number_lines(content: str) -> str:
    lines = content.splitlines()
    width = len(str(len(lines)))
    return "\n".join(f"{i:>{width}} | {line}" for i, line in enumerate(lines, 1))


MAX_EDIT_SHARE = 0.5  # one edit may not replace more than half the file


def apply_edits(content: str, edits: list[dict]) -> tuple[str, int, list[str]]:
    """Apply find/replace edits that each match exactly once.

    Returns (new_content, applied_count, rejection_reasons). An edit whose
    `find` text is missing, ambiguous, or covers most of the file is rejected,
    so a bad model answer can never rewrite or delete large parts of a file.
    """
    rejected: list[str] = []
    applied = 0
    for edit in edits:
        find, replace = edit.get("find", ""), edit.get("replace", "")
        if not find.strip():
            rejected.append("empty search text")
            continue
        if find == replace:
            continue
        count = content.count(find)
        if count == 0:
            rejected.append(f"text not found: {find.strip().splitlines()[0][:60]!r}")
            continue
        if count > 1:
            rejected.append(f"text matches {count} places: {find.strip().splitlines()[0][:60]!r}")
            continue
        if len(content) > 400 and len(find) > len(content) * MAX_EDIT_SHARE:
            rejected.append("edit would replace most of the file")
            continue
        content = content.replace(find, replace, 1)
        applied += 1
    return content, applied, rejected


def slugify(text: str, limit: int = 40) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return slug[:limit].strip("-") or "fix"
