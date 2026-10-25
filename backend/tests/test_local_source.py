"""LocalSource against a real temporary git repo (no network, no model)."""

import subprocess
from pathlib import Path

import pytest

from app import sources
from app.sources import LocalSource, SourceError


def git(cwd: Path, *args: str) -> str:
    return subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True, text=True).stdout.strip()


@pytest.fixture
def repo(tmp_path, monkeypatch):
    monkeypatch.setattr(sources.settings, "local_roots", [str(tmp_path)], raising=False)
    root = tmp_path / "project"
    root.mkdir()
    git(root, "init", "-q", "-b", "main")
    git(root, "config", "user.email", "test@example.com")
    git(root, "config", "user.name", "Test")
    (root / "app.py").write_text("def avg(xs):\n    return sum(xs) / len(xs)\n")
    (root / "package-lock.json").write_text("{}")
    git(root, "add", ".")
    git(root, "commit", "-q", "-m", "init")
    return root


def test_lists_and_reads_committed_files(repo):
    src = LocalSource(repo)
    files = {f["path"]: f for f in src.list_files()}
    assert set(files) == {"app.py", "package-lock.json"}
    assert "sum(xs)" in src.read(files["app.py"])
    assert src.branch == "main" and src.write_blocker is None


def test_create_fix_makes_branch_without_touching_working_tree(repo):
    (repo / "notes.txt").write_text("uncommitted work")  # must survive untouched
    src = LocalSource(repo)
    item = next(f for f in src.list_files() if f["path"] == "app.py")
    fixed = "def avg(xs):\n    return sum(xs) / len(xs) if xs else 0.0\n"

    fix = src.create_fix(item, fixed, "reposcan/app-py-1", "fix: empty list", "body")

    assert git(repo, "rev-parse", "--abbrev-ref", "HEAD") == "main"
    assert (repo / "app.py").read_text() == "def avg(xs):\n    return sum(xs) / len(xs)\n"
    assert (repo / "notes.txt").read_text() == "uncommitted work"
    assert git(repo, "show", "reposcan/app-py-1:app.py") == fixed.rstrip("\n")
    assert git(repo, "log", "-1", "--format=%s", "reposcan/app-py-1") == "fix: empty list"

    src.discard_fix(fix)
    assert git(repo, "branch", "--list", "reposcan/*") == ""


def test_rejects_folder_outside_allowed_roots(tmp_path, monkeypatch):
    monkeypatch.setattr(sources.settings, "local_roots", [str(tmp_path / "allowed")], raising=False)
    with pytest.raises(SourceError, match="outside the allowed folders"):
        LocalSource(tmp_path)


def test_non_git_folder_is_read_only(tmp_path, monkeypatch):
    monkeypatch.setattr(sources.settings, "local_roots", [str(tmp_path)], raising=False)
    (tmp_path / "main.go").write_text("package main\n")
    src = LocalSource(tmp_path)
    assert [f["path"] for f in src.list_files()] == ["main.go"]
    assert "git init" in src.write_blocker
