"""Per-browser-tab session state.

Each tab gets its own Session, so two tabs never overwrite each other. Work
runs in worker threads; `emit` is safe to call from any thread and forwards
events to the tab's WebSocket through an asyncio queue.
"""

import asyncio
import re
import threading
import time
import uuid
from collections import OrderedDict
from dataclasses import asdict, dataclass, field

from .config import settings

SESSION_ID_RE = re.compile(r"^[A-Za-z0-9-]{8,64}$")
MAX_SESSIONS = 200


@dataclass
class PendingAction:
    """A write action the model asked for. It runs only after the user approves it."""

    kind: str
    params: dict
    title: str
    details: list[str]
    destructive: bool = False
    id: str = field(default_factory=lambda: uuid.uuid4().hex[:12])

    def to_dict(self) -> dict:
        data = asdict(self)
        data.pop("params")
        return data


class Session:
    def __init__(self, session_id: str):
        self.id = session_id
        self.last_seen = time.time()
        self.reset()
        self.task: asyncio.Task | None = None
        self.cancel_event = threading.Event()
        self._loop: asyncio.AbstractEventLoop | None = None
        self._outbox: asyncio.Queue | None = None

    def reset(self) -> None:
        """Forget everything, including the conversation."""
        self.reset_repo()
        self.history: list[dict] = []
        self.agent = None

    def reset_repo(self) -> None:
        """Forget the loaded source and its results, but keep the conversation."""
        self.source = None
        self.files: list[dict] = []
        self.file_contents: dict[str, str] = {}
        self.issues: list[dict] = []
        self.fixes: list[dict] = []
        self.analysis: dict | None = None
        self.pending: dict[str, PendingAction] = {}

    # ── Connection plumbing ──

    def attach(self, loop: asyncio.AbstractEventLoop, outbox: asyncio.Queue) -> None:
        self._loop, self._outbox = loop, outbox

    def detach(self, outbox: asyncio.Queue) -> None:
        if self._outbox is outbox:  # a newer tab may already have taken over
            self._loop, self._outbox = None, None

    def emit(self, payload: dict) -> None:
        loop, outbox = self._loop, self._outbox
        if loop is None or outbox is None or loop.is_closed():
            return
        loop.call_soon_threadsafe(outbox.put_nowait, payload)

    @property
    def busy(self) -> bool:
        return self.task is not None and not self.task.done()

    def new_run(self) -> threading.Event:
        """Fresh cancel flag per run, so stopping one run never leaks into the next."""
        self.cancel_event = threading.Event()
        return self.cancel_event

    # ── State ──

    def request_action(self, action: PendingAction) -> PendingAction:
        self.pending[action.id] = action
        self.emit({"type": "confirm_request", "action": action.to_dict()})
        return action

    def add_history(self, role: str, content: str) -> None:
        self.history.append({"role": role, "content": content})
        self.history = self.history[-settings.history_limit:]

    def source_info(self) -> dict | None:
        src = self.source
        if src is None:
            return None
        return {
            "kind": src.kind,
            "label": src.label,
            "location": src.location,
            "branch": src.branch,
            "commit": (src.base_sha or "")[:7],
            "file_count": len(self.files),
            "write_blocker": src.write_blocker,
            "write_mode": src.write_mode,
            "fork": src.fork_name,
            "notes": src.notes,
        }

    def snapshot(self) -> dict:
        return {
            "source": self.source_info(),
            "issues": self.issues,
            "fixes": self.fixes,
            "analysis": self.analysis,
            "pending": [a.to_dict() for a in self.pending.values()],
            "busy": self.busy,
        }


class SessionStore:
    def __init__(self) -> None:
        self._sessions: OrderedDict[str, Session] = OrderedDict()

    def get(self, session_id: str) -> Session:
        if not SESSION_ID_RE.match(session_id or ""):
            raise ValueError("invalid session id")
        session = self._sessions.get(session_id)
        if session is None:
            session = Session(session_id)
            self._sessions[session_id] = session
            self._evict()
        self._sessions.move_to_end(session_id)
        session.last_seen = time.time()
        return session

    def _evict(self) -> None:
        while len(self._sessions) > MAX_SESSIONS:
            oldest_id, oldest = next(iter(self._sessions.items()))
            if oldest.busy:
                break
            del self._sessions[oldest_id]


sessions = SessionStore()
