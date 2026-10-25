"""The actual work: load a source, review files, create and discard fixes.

Functions here are synchronous and run in worker threads. They report
progress through `session.emit`, check the run's cancel flag between files,
and return Markdown for the chat. User-facing problems raise SourceError.
"""

import logging
import threading
import time
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from pathlib import PurePosixPath

from github import GithubException

from . import llm
from .config import settings
from .repo_utils import (
    SEVERITY_EMOJI, SEVERITY_RANK, apply_edits, highest_severity, select_files, slugify,
)
from .session import PendingAction, Session
from .sources import GitHubSource, SourceError, open_source

log = logging.getLogger("reposcan")

FILTERS = {"all", *SEVERITY_RANK}


def _require_source(session: Session):
    if session.source is None:
        raise SourceError("No repository loaded yet. Load a GitHub repo or a local folder first.")
    return session.source


def _require_github(session: Session) -> GitHubSource:
    src = _require_source(session)
    if not isinstance(src, GitHubSource):
        raise SourceError("That only works for GitHub repositories, not local folders.")
    return src


def _require_manage(session: Session) -> GitHubSource:
    """GitHub source where the user may close and merge other people's PRs."""
    src = _require_github(session)
    if src.manage_blocker:
        raise SourceError(src.manage_blocker)
    return src


def _severity_filter(value: str) -> str:
    value = (value or "all").strip().lower()
    if value not in FILTERS:
        raise SourceError(f"Unknown severity '{value}'. Use all, critical, high, medium or low.")
    return value


def _progress(session: Session, phase: str, done: int, total: int, current: str | None = None) -> None:
    session.emit({"type": "progress", "phase": phase, "done": done, "total": total, "current": current})


def _plural(count: int, word: str) -> str:
    if count == 1:
        return word
    return word + ("es" if word.endswith(("ch", "sh", "s", "x")) else "s")


def _issue_line(issue: dict) -> str:
    where = f"`{issue['file']}`" + (f" line {issue['line']}" if issue.get("line") else "")
    return f"{SEVERITY_EMOJI[issue['severity']]} **#{issue['id']} {issue['title']}**: {where}"


# ── Load & analyze ───────────────────────────────────────────────


def load_source(session: Session, text: str) -> str:
    src = open_source(text)
    files = src.list_files()
    session.reset_repo()
    session.source, session.files = src, files
    eligible, skipped, _ = select_files(files, "all", 10**9, settings.max_file_chars)

    where = f" on `{src.branch}` ({src.base_sha[:7]})" if src.base_sha else ""
    lines = [
        f"Loaded **{src.label}**{where}.",
        f"{len(files):,} files, **{len(eligible):,}** can be reviewed"
        + (f" ({len(skipped)} skipped: lockfiles, vendored or too large)." if skipped else "."),
    ]
    if len(eligible) > settings.max_files:
        lines.append(
            f"One analysis run covers up to {settings.max_files} files. "
            "Narrow it with a folder or extension filter, like `src/` or `.py`."
        )
    lines += [f"> {note}" for note in src.notes]
    return "\n\n".join(lines)


def analyze(session: Session, file_filter: str, cancel: threading.Event) -> str:
    src = _require_source(session)
    selected, skipped, overflow = select_files(
        session.files, file_filter, settings.max_files, settings.max_file_chars
    )
    if not selected:
        return f"No reviewable files match `{file_filter}`." if file_filter not in {"", "all"} else "No reviewable files found."

    total = len(selected)
    found: list[dict] = []
    errors: list[str] = []
    reviewed: set[str] = set()
    _progress(session, "analyze", 0, total)

    def review(item: dict) -> list[dict]:
        if cancel.is_set():
            return []
        content = src.read(item)
        if content is None:
            skipped.append({"path": item["path"], "reason": "binary file"})
            return []
        if len(content) > settings.max_file_chars:
            skipped.append({"path": item["path"], "reason": "too large"})
            return []
        session.file_contents[item["path"]] = content
        issues = llm.review_file(item["path"], content)
        reviewed.add(item["path"])
        return issues

    with ThreadPoolExecutor(max_workers=settings.concurrency) as pool:
        queue = list(selected)
        running = {}
        done = 0
        while queue or running:
            while queue and len(running) < settings.concurrency and not cancel.is_set():
                item = queue.pop(0)
                running[pool.submit(review, item)] = item
                _progress(session, "analyze", done, total, item["path"])
            if not running:
                break
            finished, _ = wait(running, return_when=FIRST_COMPLETED)
            for future in finished:
                item = running.pop(future)
                done += 1
                try:
                    found.extend(future.result())
                except Exception as exc:  # noqa: BLE001 - report per file, keep going
                    log.warning("review failed for %s: %s", item["path"], exc)
                    errors.append(f"`{item['path']}`: {exc}")
                _progress(session, "analyze", done, total, None)

    if errors and not reviewed:
        raise SourceError(f"Analysis failed. {errors[0].split(': ', 1)[-1]}")

    # Replace issues only for the files reviewed in this run.
    kept = [i for i in session.issues if i["file"] not in reviewed]
    merged = kept + [{**i, "status": "open"} for i in found]
    merged.sort(key=lambda i: (SEVERITY_RANK[i["severity"]], i["file"], i["line"] or 0))
    for number, issue in enumerate(merged, 1):
        issue["id"] = number
    session.issues = merged
    session.analysis = {
        "reviewed": len(reviewed), "skipped": skipped, "errors": len(errors),
        "cancelled": cancel.is_set(), "overflow": overflow, "at": int(time.time()),
    }

    counts = {s: sum(1 for i in found if i["severity"] == s) for s in SEVERITY_RANK}
    lines = []
    if cancel.is_set():
        lines.append(f"Stopped early. Reviewed {len(reviewed)} of {total} files.")
    lines.append(
        f"Reviewed **{len(reviewed)}** file(s) and found **{len(found)}** issue(s): "
        + "  ".join(f"{SEVERITY_EMOJI[s]} {counts[s]} {s}" for s in SEVERITY_RANK)
    )
    if overflow:
        lines.append(f"{overflow} more file(s) matched but were left out (limit {settings.max_files} per run).")
    if errors:
        lines.append(f"{len(errors)} file(s) failed:\n" + "\n".join(f"- {e}" for e in errors[:5]))
    return "\n\n".join(lines)


def show_issues(session: Session, severity: str) -> str:
    severity = _severity_filter(severity)
    if not session.issues:
        return "No issues yet. Run an analysis first."
    issues = [i for i in session.issues if severity == "all" or i["severity"] == severity]
    if not issues:
        return f"No {severity} issues."
    shown = issues[:30]
    more = f"\n\n…and {len(issues) - 30} more." if len(issues) > 30 else ""
    return f"{len(issues)} {'' if severity == 'all' else severity + ' '}issue(s):\n\n" + "\n".join(
        f"- {_issue_line(i)}" for i in shown
    ) + more


def explain_issue(session: Session, number: int) -> str:
    issue = next((i for i in session.issues if i["id"] == number), None)
    if issue is None:
        return f"There is no issue #{number}." if session.issues else "No issues yet. Run an analysis first."
    return f"{_issue_line(issue)}\n\n**Severity:** {issue['severity']}\n\n{issue['description']}"


# ── Fixes ────────────────────────────────────────────────────────


def _target_groups(session: Session, severity: str, file_filter: str) -> dict[str, list[dict]]:
    needle = (file_filter or "").strip().lower()
    groups: dict[str, list[dict]] = {}
    for issue in session.issues:
        if issue.get("status") != "open":
            continue
        if severity != "all" and issue["severity"] != severity:
            continue
        if needle and needle not in issue["file"].lower():
            continue
        if issue["file"] in session.file_contents:
            groups.setdefault(issue["file"], []).append(issue)
    return groups


def preview_create_fixes(session: Session, severity: str = "all", file_filter: str = "") -> PendingAction:
    src = _require_source(session)
    severity = _severity_filter(severity)
    if src.write_blocker:
        raise SourceError(src.write_blocker)
    if not session.issues:
        raise SourceError("No issues yet. Run an analysis first.")
    groups = _target_groups(session, severity, file_filter)
    if not groups:
        raise SourceError("No open issues match. They may already have fixes.")

    noun = "pull request" if src.kind == "github" else "fix branch"
    via = f" from your fork {src.fork_name}" if getattr(src, "write_mode", None) == "fork" else ""
    details = [
        f"{SEVERITY_EMOJI[highest_severity([i['severity'] for i in issues])]} `{path}`: "
        f"{len(issues)} issue{'s' if len(issues) != 1 else ''}"
        for path, issues in sorted(groups.items())
    ]
    target = f"{src.label}" + (f" (base `{src.branch}`)" if src.branch else "")
    return PendingAction(
        kind="create_fixes",
        params={"severity": severity, "file_filter": file_filter},
        title=f"Create {len(groups)} {_plural(len(groups), noun)} in {target}{via}",
        details=details,
    )


def create_fixes(session: Session, severity: str, file_filter: str, cancel: threading.Event) -> str:
    src = _require_source(session)
    if src.write_blocker:
        raise SourceError(src.write_blocker)
    groups = _target_groups(session, severity, file_filter)
    items = {f["path"]: f for f in session.files}
    created, skipped = [], []
    total = len(groups)
    _progress(session, "fix", 0, total)

    for done, (path, issues) in enumerate(sorted(groups.items())):
        if cancel.is_set():
            break
        _progress(session, "fix", done, total, path)
        original = session.file_contents[path]
        try:
            edits, summary = llm.propose_edits(path, original, issues)
            updated, applied, rejected = apply_edits(original, edits)
            if not applied:
                reason = rejected[0] if rejected else "the model proposed no changes"
                skipped.append(f"`{path}`: {reason}")
                continue
            name = PurePosixPath(path).name
            title = (
                f"fix({name}): {issues[0]['title']}" if len(issues) == 1
                else f"fix({name}): {len(issues)} issues found by RepoScan"
            )
            branch = f"reposcan/{slugify(path, 32)}-{int(time.time() * 1000) % 10**6}"
            body = _fix_body(issues, summary, rejected)
            fix = src.create_fix(items[path], updated, branch, title, body)
        except (SourceError, llm.ModelError, GithubException) as exc:
            msg = exc.data.get("message", str(exc)) if isinstance(exc, GithubException) and isinstance(exc.data, dict) else str(exc)
            skipped.append(f"`{path}`: {msg}")
            continue

        for issue in issues:
            issue["status"] = "fixed"
        record = {
            **fix,
            "id": fix["branch"],
            "file": path,
            "title": title,
            "summary": summary,
            "severity": highest_severity([i["severity"] for i in issues]),
            "issue_ids": [i["id"] for i in issues],
            "edits": applied,
        }
        session.fixes.append(record)
        created.append(record)
    _progress(session, "fix", total, total)

    lines = []
    if cancel.is_set():
        lines.append("Stopped early.")
    if created:
        noun = "pull request" if src.kind == "github" else "fix branch"
        lines.append(f"Created **{len(created)}** {_plural(len(created), noun)}:")
        for f in created:
            ref = f"[#{f['number']}]({f['url']})" if f.get("url") else f"`{f['branch']}`"
            lines.append(f"- {SEVERITY_EMOJI[f['severity']]} {ref}: {f['title']}")
        if src.kind == "local":
            lines.append(
                f"Review with `git diff {src.branch}...<branch>` and merge with `git merge <branch>`. "
                "Your working copy was not changed."
            )
    if skipped:
        lines.append(f"Skipped {len(skipped)} file(s):\n" + "\n".join(f"- {s}" for s in skipped))
    return "\n\n".join(lines) or "Nothing was changed."


def _fix_body(issues: list[dict], summary: str, rejected: list[str]) -> str:
    parts = ["## RepoScan automated fix", "", "Issues addressed:", ""]
    for i in issues:
        line = f" (line {i['line']})" if i.get("line") else ""
        parts.append(f"- **[{i['severity'].upper()}] {i['title']}**{line}: {i['description']}")
    if summary:
        parts += ["", "### What changed", "", summary]
    if rejected:
        parts += ["", "### Edits not applied", ""] + [f"- {r}" for r in rejected]
    parts += [
        "", "---",
        f"_Written by a local model ({settings.ollama_model}) via RepoScan. "
        "Review carefully before merging._",
    ]
    return "\n".join(parts)


def _find_fixes(session: Session, severity: str, fix_ids: list[str] | None) -> list[dict]:
    if fix_ids:
        return [f for f in session.fixes if f["id"] in fix_ids]
    return [f for f in session.fixes if severity == "all" or f["severity"] == severity]


def preview_discard_fixes(session: Session, severity: str = "all", fix_ids: list[str] | None = None) -> PendingAction:
    src = _require_source(session)
    fixes = _find_fixes(session, _severity_filter(severity), fix_ids)
    if not fixes:
        raise SourceError("No RepoScan fixes match.")
    what = "Close PR and delete branch" if src.kind == "github" else "Delete branch"
    return PendingAction(
        kind="discard_fixes",
        params={"fix_ids": [f["id"] for f in fixes]},
        title=f"Discard {len(fixes)} RepoScan fix{'es' if len(fixes) != 1 else ''}",
        details=[f"{what}: `{f['branch']}`" for f in fixes],
        destructive=True,
    )


def discard_fixes(session: Session, fix_ids: list[str]) -> str:
    src = _require_source(session)
    results = []
    for fix in [f for f in session.fixes if f["id"] in fix_ids]:
        try:
            src.discard_fix(fix)
        except (SourceError, GithubException) as exc:
            results.append(f"- Could not discard `{fix['branch']}`: {exc}")
            continue
        session.fixes.remove(fix)
        for issue in session.issues:
            if issue["id"] in fix["issue_ids"]:
                issue["status"] = "open"
        results.append(f"- Discarded `{fix['branch']}`")
    return "\n".join(results) or "Nothing to discard."


# ── GitHub pull requests ─────────────────────────────────────────


def list_prs(session: Session, state: str) -> str:
    src = _require_github(session)
    pulls = src.list_pulls(state)
    if not pulls:
        return f"No {state} pull requests in {src.label}."
    return f"{len(pulls)} {state} pull request(s) in {src.label}:\n\n" + "\n".join(
        f"- [#{p['number']}]({p['url']}) {p['title']} by `{p['author']}` ({p['state']}, {p['created']})"
        for p in pulls
    )


def get_pr(session: Session, number: int) -> str:
    pull = _require_github(session).get_pull(number)
    files = [f.filename for f in pull.get_files()[:30]]
    body = (pull.body or "No description.").strip()
    return (
        f"**[#{pull.number}]({pull.html_url}) {pull.title}**\n\n"
        f"By `{pull.user.login}`, `{pull.head.ref}` → `{pull.base.ref}`, state **{pull.state}**, "
        f"mergeable: {pull.mergeable}\n\n"
        f"Files changed ({pull.changed_files}):\n" + "\n".join(f"- `{f}`" for f in files)
        + f"\n\n{body[:1500]}"
    )


def preview_close_pr(session: Session, number: int, delete_branch: bool) -> PendingAction:
    pull = _require_manage(session).get_pull(number)
    return PendingAction(
        kind="close_pr",
        params={"number": number, "delete_branch": delete_branch},
        title=f"Close PR #{number}" + (" and delete its branch" if delete_branch else ""),
        details=[f"#{number} {pull.title} by `{pull.user.login}`"],
        destructive=True,
    )


def preview_close_all(session: Session, delete_branches: bool) -> PendingAction:
    pulls = _require_manage(session).list_pulls("open")
    if not pulls:
        raise SourceError("There are no open pull requests.")
    return PendingAction(
        kind="close_all",
        # Exactly these PRs, so nothing opened after the preview gets closed.
        params={"numbers": [p["number"] for p in pulls], "delete_branches": delete_branches},
        title=f"Close all {len(pulls)} open PRs" + (" and delete their branches" if delete_branches else ""),
        details=[f"#{p['number']} {p['title']} by `{p['author']}`" for p in pulls],
        destructive=True,
    )


def preview_merge_pr(session: Session, number: int, method: str) -> PendingAction:
    pull = _require_manage(session).get_pull(number)
    method = method if method in {"merge", "squash", "rebase"} else "squash"
    return PendingAction(
        kind="merge_pr",
        params={"number": number, "method": method},
        title=f"Merge PR #{number} into `{pull.base.ref}` ({method})",
        details=[f"#{number} {pull.title} by `{pull.user.login}`", f"Mergeable: {pull.mergeable}"],
        destructive=True,
    )


def close_prs(session: Session, numbers: list[int], delete_branches: bool) -> str:
    src = _require_github(session)
    lines = []
    for number in numbers:
        try:
            lines.append("- " + src.close_pull(number, delete_branches))
        except (SourceError, GithubException) as exc:
            lines.append(f"- PR #{number}: {exc}")
        session.fixes = [f for f in session.fixes if f.get("number") != number]
    return "\n".join(lines)


def merge_pr(session: Session, number: int, method: str) -> str:
    return _require_github(session).merge_pull(number, method)


# ── Approved actions ─────────────────────────────────────────────


def run_action(session: Session, action: PendingAction, cancel: threading.Event) -> str:
    p = action.params
    if action.kind == "create_fixes":
        return create_fixes(session, p["severity"], p["file_filter"], cancel)
    if action.kind == "discard_fixes":
        return discard_fixes(session, p["fix_ids"])
    if action.kind == "close_pr":
        return close_prs(session, [p["number"]], p["delete_branch"])
    if action.kind == "close_all":
        return close_prs(session, p["numbers"], p["delete_branches"])
    if action.kind == "merge_pr":
        return merge_pr(session, p["number"], p["method"])
    raise SourceError(f"Unknown action {action.kind}")
