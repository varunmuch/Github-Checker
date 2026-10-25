from app.sources import decide_write_mode

LABEL = "someone/project"


def test_no_token_blocks_writes():
    mode, blocker = decide_write_mode("", can_push=False, archived=False, label=LABEL)
    assert mode is None and "GITHUB_TOKEN" in blocker


def test_push_access_writes_directly():
    assert decide_write_mode("ghp_x", can_push=True, archived=False, label=LABEL) == ("direct", None)
    assert decide_write_mode("github_pat_x", can_push=True, archived=False, label=LABEL) == ("direct", None)


def test_classic_token_without_push_uses_fork():
    assert decide_write_mode("ghp_x", can_push=False, archived=False, label=LABEL) == ("fork", None)


def test_fine_grained_token_without_push_is_blocked_up_front():
    mode, blocker = decide_write_mode("github_pat_x", can_push=False, archived=False, label=LABEL)
    assert mode is None
    assert "classic token" in blocker and LABEL in blocker


def test_archived_repo_is_blocked():
    mode, blocker = decide_write_mode("ghp_x", can_push=True, archived=True, label=LABEL)
    assert mode is None and "archived" in blocker


# ── create_fix with stand-in GitHub objects ──

import pytest
from github import GithubException

from app.sources import GitHubSource, SourceError


class FakeRef:
    def __init__(self, repo, name):
        self.repo, self.name = repo, name

    def delete(self):
        self.repo.refs.discard(self.name)


class FakeRepo:
    def __init__(self, full_name, fail_pull=False):
        self.full_name = full_name
        self.owner = type("Owner", (), {"login": full_name.split("/")[0]})()
        self.refs, self.files, self.pulls = set(), {}, []
        self.fail_pull = fail_pull

    def create_git_ref(self, ref, sha):
        self.refs.add(ref.removeprefix("refs/"))

    def get_git_ref(self, name):
        return FakeRef(self, name)

    def update_file(self, path, message, content, sha, branch):
        self.files[(branch, path)] = content

    def create_pull(self, base, head, title, body, **kwargs):
        if self.fail_pull:
            raise GithubException(422, {"message": "Validation Failed"}, None)
        self.pulls.append({"base": base, "head": head, **kwargs})
        return type("Pull", (), {"html_url": "https://github.com/x/pull/7", "number": 7})()


def make_source(mode, upstream, fork=None):
    src = object.__new__(GitHubSource)
    src._repo, src._fork = upstream, fork
    src.write_mode, src._write_blocker = mode, None
    src.branch, src.base_sha, src.label = "main", "abc123", upstream.full_name
    return src


ITEM = {"path": "app.py", "sha": "blob1"}


def test_direct_mode_branches_in_the_repo_itself():
    upstream = FakeRepo("me/project")
    fix = make_source("direct", upstream).create_fix(ITEM, "fixed", "reposcan/x", "t", "b")
    assert upstream.pulls == [{"base": "main", "head": "reposcan/x"}]
    assert fix["head_repo"] is None and fix["number"] == 7


def test_fork_mode_branches_in_fork_and_opens_pr_upstream():
    upstream, fork = FakeRepo("someone/project"), FakeRepo("me/project")
    fix = make_source("fork", upstream, fork).create_fix(ITEM, "fixed", "reposcan/x", "t", "b")
    assert fork.files == {("reposcan/x", "app.py"): "fixed"} and upstream.files == {}
    assert upstream.pulls == [{"base": "main", "head": "me:reposcan/x", "maintainer_can_modify": True}]
    assert fix["head_repo"] == "me/project"


def test_failed_pr_removes_the_branch_it_created():
    upstream, fork = FakeRepo("someone/project", fail_pull=True), FakeRepo("me/project")
    with pytest.raises(SourceError, match="Validation Failed"):
        make_source("fork", upstream, fork).create_fix(ITEM, "fixed", "reposcan/x", "t", "b")
    assert fork.refs == set()
