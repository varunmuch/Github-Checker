"""Where code is read from and where fixes are written to.

* GitHubSource reads a repo through the GitHub API and delivers each fix as a
  pull request: straight from a branch in the repo when the token can push to
  it, otherwise from a branch in the user's fork.
* LocalSource reads a folder on this machine and delivers each fix as a new
  git branch. It commits with git plumbing commands, so the user's checked-out
  branch, working tree and index are never touched.
"""

import base64
import os
import subprocess
import tempfile
import time
from functools import lru_cache
from pathlib import Path

from github import Auth, Github, GithubException

from .config import settings
from .repo_utils import IGNORED_DIRS, parse_repo_url


class SourceError(Exception):
    """A problem worth showing to the user as-is."""


# ── GitHub ────────────────────────────────────────────────────────


@lru_cache(maxsize=1)
def github_client() -> Github:
    if settings.github_token:
        return Github(auth=Auth.Token(settings.github_token), per_page=100)
    return Github(per_page=100)  # anonymous: public repos only, low rate limit


def _gh_message(exc: GithubException) -> str:
    data = exc.data if isinstance(exc.data, dict) else {}
    return data.get("message") or str(exc)


FINE_GRAINED_FORK_MSG = (
    "You don't have write access to {label}. Opening a pull request from your fork needs a "
    "classic token with the `public_repo` scope: fine-grained tokens can't open pull requests "
    "on repositories you don't own."
)


def decide_write_mode(token: str, can_push: bool, archived: bool, label: str) -> tuple[str | None, str | None]:
    """How fixes reach a GitHub repo. Returns (mode, blocker).

    mode is "direct" (branch in the repo itself), "fork" (branch in the user's
    fork, PR to the original) or None, in which case blocker says why.
    """
    if not token:
        return None, "Opening pull requests needs GITHUB_TOKEN in backend/.env."
    if archived:
        return None, f"{label} is archived, so it can't receive pull requests."
    if can_push:
        return "direct", None
    if token.startswith("github_pat_"):
        return None, FINE_GRAINED_FORK_MSG.format(label=label)
    return "fork", None


class GitHubSource:
    kind = "github"

    def __init__(self, owner: str, repo: str):
        try:
            self._repo = github_client().get_repo(f"{owner}/{repo}")
        except GithubException as exc:
            if exc.status == 404:
                hint = "" if settings.github_token else " Private repos need GITHUB_TOKEN."
                raise SourceError(f"Repository {owner}/{repo} was not found.{hint}") from exc
            if exc.status == 401:
                raise SourceError(
                    "GitHub rejected GITHUB_TOKEN (wrong or expired). Update it in backend/.env, "
                    "or remove it to read public repos without a token."
                ) from exc
            if exc.status == 403 and "rate limit" in _gh_message(exc).lower():
                raise SourceError("GitHub rate limit reached. Add GITHUB_TOKEN to backend/.env for a higher limit.") from exc
            raise SourceError(f"GitHub error: {_gh_message(exc)}") from exc
        self.label = self._repo.full_name
        self.location = self._repo.html_url
        self.branch = self._repo.default_branch
        self.base_sha = self._repo.get_branch(self.branch).commit.sha
        self.truncated = False
        self.notes: list[str] = []

        # Work out up front whether fixes can be delivered, and how.
        perms = self._repo.permissions if settings.github_token else None
        can_push = bool(perms and (perms.push or perms.maintain or perms.admin))
        self.write_mode, self._write_blocker = decide_write_mode(
            settings.github_token, can_push, self._repo.archived, self.label
        )
        self.login: str | None = None
        self.fork_name: str | None = None
        self._fork = None
        if self.write_mode == "fork":
            self.login = github_client().get_user().login
            self.fork_name = f"{self.login}/{self._repo.name}"
            self.notes.append(
                f"You don't have write access to {self.label}, so fixes will be opened as pull "
                f"requests from your fork ({self.fork_name}). RepoScan creates the fork if needed."
            )

    # Reading

    def list_files(self) -> list[dict]:
        tree = self._repo.get_git_tree(self.base_sha, recursive=True)
        self.truncated = bool(tree.raw_data.get("truncated"))
        if self.truncated:
            self.notes.append("GitHub truncated the file list because the repo is very large.")
        return [
            {"path": t.path, "sha": t.sha, "size": t.size}
            for t in tree.tree
            if t.type == "blob"
        ]

    def read(self, item: dict) -> str | None:
        blob = self._repo.get_git_blob(item["sha"])
        raw = base64.b64decode(blob.content)
        return None if b"\0" in raw[:8000] else raw.decode("utf-8", errors="replace")

    # Writing

    @property
    def write_blocker(self) -> str | None:
        return self._write_blocker

    @property
    def manage_blocker(self) -> str | None:
        """Why this user can't close or merge other people's PRs here, if they can't."""
        if self.write_mode == "direct":
            return None
        return self._write_blocker or f"You don't have write access to {self.label}, so you can't close or merge its pull requests."

    def _ensure_fork(self):
        """Return the user's fork, creating it and waiting for it if needed."""
        if self._fork is not None:
            return self._fork
        gh = github_client()
        try:
            fork = gh.get_repo(self.fork_name)
            if not fork.fork or fork.parent is None or fork.parent.full_name != self._repo.full_name:
                raise SourceError(
                    f"You already have a repository named {self.fork_name} that isn't a fork of "
                    f"{self.label}. Rename it on GitHub and try again."
                )
        except GithubException as exc:
            if exc.status != 404:
                raise
            # GitHub returns the existing fork if there is one under another name.
            fork = gh.get_user().create_fork(self._repo, default_branch_only=True)
            self.fork_name = fork.full_name

        # Forks are created in the background, and older forks can lag behind.
        for _ in range(30):
            try:
                fork.get_git_commit(self.base_sha)
                break
            except GithubException:
                try:
                    fork.merge_upstream(self.branch)
                except GithubException:
                    pass
                time.sleep(2)
        else:
            raise SourceError(
                f"Your fork {self.fork_name} isn't ready or is out of date. "
                "Sync it on GitHub, then try again."
            )
        self._fork = fork
        return fork

    def create_fix(self, item: dict, new_content: str, branch: str, title: str, body: str) -> dict:
        if self._write_blocker:
            raise SourceError(self._write_blocker)
        via_fork = self.write_mode == "fork"
        target = self._ensure_fork() if via_fork else self._repo
        try:
            target.create_git_ref(ref=f"refs/heads/{branch}", sha=self.base_sha)
        except GithubException as exc:
            raise self._write_error(exc) from exc
        try:
            target.update_file(
                path=item["path"], message=title, content=new_content,
                sha=item["sha"], branch=branch,
            )
            extra = {"maintainer_can_modify": True} if via_fork else {}
            pull = self._repo.create_pull(
                base=self.branch,
                head=f"{target.owner.login}:{branch}" if via_fork else branch,
                title=title, body=body, **extra,
            )
        except GithubException as exc:
            self._delete_branch(target, branch)  # don't leave half-made branches behind
            raise self._write_error(exc) from exc
        return {
            "kind": "pr", "url": pull.html_url, "number": pull.number, "branch": branch,
            "head_repo": target.full_name if via_fork else None,
        }

    def _write_error(self, exc: GithubException) -> SourceError:
        msg = _gh_message(exc)
        if exc.status in (403, 404):
            hint = (
                " Your token may lack permission to fork or open pull requests (classic token: "
                "`public_repo` scope)." if self.write_mode == "fork"
                else " Check that GITHUB_TOKEN has Contents and Pull requests write access."
            )
            return SourceError(f"GitHub refused the change: {msg}.{hint}")
        return SourceError(f"GitHub error: {msg}")

    def discard_fix(self, fix: dict) -> None:
        if fix.get("number"):
            self._repo.get_pull(fix["number"]).edit(state="closed")  # authors may close their own PRs
        target = github_client().get_repo(fix["head_repo"]) if fix.get("head_repo") else self._repo
        self._delete_branch(target, fix["branch"])

    @staticmethod
    def _delete_branch(repo, branch: str) -> bool:
        try:
            repo.get_git_ref(f"heads/{branch}").delete()
            return True
        except GithubException:
            return False

    # Pull request management

    def list_pulls(self, state: str) -> list[dict]:
        state = state if state in {"open", "closed", "all"} else "open"
        pulls = self._repo.get_pulls(state=state)
        return [self._pull_summary(p) for p in pulls[:50]]

    def get_pull(self, number: int):
        try:
            return self._repo.get_pull(number)
        except GithubException as exc:
            if exc.status == 404:
                raise SourceError(f"PR #{number} was not found.") from exc
            raise

    def close_pull(self, number: int, delete_branch: bool) -> str:
        pull = self.get_pull(number)
        if pull.state == "closed":
            return f"PR #{number} was already closed."
        pull.edit(state="closed")
        note = ""
        if delete_branch:
            same_repo = pull.head.repo and pull.head.repo.full_name == self._repo.full_name
            if not same_repo:
                note = " (branch lives in a fork, left alone)"
            elif self._delete_branch(self._repo, pull.head.ref):
                note = f" and deleted branch `{pull.head.ref}`"
            else:
                note = " (branch could not be deleted)"
        return f"Closed PR #{number}: {pull.title}{note}."

    def merge_pull(self, number: int, method: str) -> str:
        pull = self.get_pull(number)
        method = method if method in {"merge", "squash", "rebase"} else "squash"
        try:
            pull.merge(merge_method=method)
        except GithubException as exc:
            raise SourceError(f"PR #{number} could not be merged: {_gh_message(exc)}") from exc
        return f"Merged PR #{number} ({method}): {pull.title}."

    @staticmethod
    def _pull_summary(p) -> dict:
        return {
            "number": p.number, "title": p.title, "url": p.html_url, "state": p.state,
            "author": p.user.login if p.user else "unknown", "branch": p.head.ref,
            "created": str(p.created_at)[:10],
        }


# ── Local folder ──────────────────────────────────────────────────


def _git(cwd: Path, *args: str, stdin: bytes | None = None, env: dict | None = None) -> str:
    result = subprocess.run(
        ["git", *args], cwd=cwd, input=stdin, capture_output=True, timeout=60,
        env={**os.environ, **(env or {})},
    )
    if result.returncode != 0:
        raise SourceError(f"git {args[0]} failed: {result.stderr.decode(errors='replace').strip()}")
    return result.stdout.decode(errors="replace").strip()


def resolve_local_path(text: str) -> Path | None:
    """Return a directory path if the text looks like a local folder, else None."""
    text = text.strip().strip("'\"")
    if not text.startswith(("/", "~", "./", "../")):
        return None
    return Path(text).expanduser().resolve()


class LocalSource:
    kind = "local"

    def __init__(self, path: Path):
        path = path.expanduser().resolve()
        if not path.is_dir():
            raise SourceError(f"Folder not found: {path}")
        roots = [Path(r).expanduser().resolve() for r in settings.local_roots]
        if not any(path == r or r in path.parents for r in roots):
            allowed = ", ".join(str(r) for r in roots)
            raise SourceError(f"{path} is outside the allowed folders ({allowed}). See LOCAL_ROOTS.")

        self.notes: list[str] = []
        self.truncated = False
        self.is_git = False
        try:
            self.root = Path(_git(path, "rev-parse", "--show-toplevel"))
            self.base_sha = _git(self.root, "rev-parse", "HEAD")
            self.branch = _git(self.root, "rev-parse", "--abbrev-ref", "HEAD")
            self.is_git = True
        except SourceError:
            self.root, self.base_sha, self.branch = path, "", ""

        self.label = self.root.name
        self.location = str(self.root)
        self.write_mode = "branch" if self.is_git else None
        self.fork_name = None
        if self.is_git:
            dirty = _git(self.root, "status", "--porcelain")
            if dirty:
                self.notes.append(
                    "This folder has uncommitted changes. RepoScan reviews the last commit "
                    f"({self.base_sha[:7]} on `{self.branch}`), so commit first to include them."
                )
        else:
            self.notes.append("This folder is not a git repository, so fixes can't be applied.")

    # Reading

    def list_files(self) -> list[dict]:
        if self.is_git:
            files = []
            for line in _git(self.root, "ls-tree", "-r", "-l", "-z", self.base_sha).split("\0"):
                if not line:
                    continue
                meta, path = line.split("\t", 1)
                mode, obj_type, sha, size = meta.split()
                if obj_type == "blob" and mode != "120000":  # skip symlinks
                    files.append({"path": path, "sha": sha, "size": int(size), "mode": mode})
            return files
        files = []
        for dirpath, dirnames, filenames in os.walk(self.root):
            dirnames[:] = [d for d in dirnames if d not in IGNORED_DIRS and not d.startswith(".")]
            for name in filenames:
                full = Path(dirpath) / name
                if full.is_symlink():
                    continue
                files.append({"path": full.relative_to(self.root).as_posix(), "size": full.stat().st_size})
        return files

    def read(self, item: dict) -> str | None:
        if self.is_git:
            raw = subprocess.run(
                ["git", "cat-file", "blob", item["sha"]], cwd=self.root,
                capture_output=True, timeout=30, check=True,
            ).stdout
        else:
            raw = (self.root / item["path"]).read_bytes()
        return None if b"\0" in raw[:8000] else raw.decode("utf-8", errors="replace")

    # Writing

    @property
    def write_blocker(self) -> str | None:
        if not self.is_git:
            return "Fixes for local folders are saved as git branches. Run `git init` and commit first."
        return None

    def create_fix(self, item: dict, new_content: str, branch: str, title: str, body: str) -> dict:
        ref = f"refs/heads/{branch}"
        if subprocess.run(["git", "show-ref", "--verify", "--quiet", ref], cwd=self.root).returncode == 0:
            raise SourceError(f"Branch {branch} already exists.")
        blob = _git(self.root, "hash-object", "-w", "--stdin", stdin=new_content.encode())
        with tempfile.TemporaryDirectory() as tmp:
            env = {"GIT_INDEX_FILE": str(Path(tmp) / "index")}
            _git(self.root, "read-tree", self.base_sha, env=env)
            _git(self.root, "update-index", "--cacheinfo", f"{item.get('mode', '100644')},{blob},{item['path']}", env=env)
            tree = _git(self.root, "write-tree", env=env)
        commit = _git(self.root, "commit-tree", tree, "-p", self.base_sha, "-m", f"{title}\n\n{body}")
        _git(self.root, "update-ref", ref, commit, "")  # "" = must not already exist
        return {"kind": "branch", "url": None, "number": None, "branch": branch, "commit": commit}

    def discard_fix(self, fix: dict) -> None:
        current = _git(self.root, "rev-parse", "--abbrev-ref", "HEAD")
        if current == fix["branch"]:
            raise SourceError(f"`{fix['branch']}` is checked out right now. Switch branches first.")
        _git(self.root, "update-ref", "-d", f"refs/heads/{fix['branch']}")


def open_source(text: str) -> GitHubSource | LocalSource:
    path = resolve_local_path(text)
    if path is not None:
        return LocalSource(path)
    parsed = parse_repo_url(text)
    if parsed:
        return GitHubSource(*parsed)
    raise SourceError(
        "Give me a GitHub URL (https://github.com/owner/repo), `owner/repo`, "
        "or an absolute folder path like /Users/you/project."
    )
