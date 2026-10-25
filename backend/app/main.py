"""HTTP + WebSocket API.

Run with:  uvicorn app.main:app --port 8000
"""

import asyncio
import hmac
import logging
from pathlib import Path

from fastapi import FastAPI, Header, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from . import llm
from . import operations as ops
from .agent import run_chat
from .config import settings
from .session import Session, sessions
from .sources import SourceError

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
log = logging.getLogger("reposcan")

app = FastAPI(title="RepoScan", version="2.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["Authorization", "Content-Type", "X-Session-ID"],
)

MAX_MESSAGE_CHARS = 4000


def _token_ok(value: str | None) -> bool:
    if not settings.api_token:
        return True
    return bool(value) and hmac.compare_digest(value, settings.api_token)


def _http_session(session_id: str | None, authorization: str | None) -> Session:
    token = (authorization or "").removeprefix("Bearer ").strip()
    if not _token_ok(token):
        raise HTTPException(401, "Missing or invalid API token")
    try:
        return sessions.get(session_id or "")
    except ValueError as exc:
        raise HTTPException(400, "Missing or invalid X-Session-ID header") from exc


def _friendly(exc: Exception) -> str:
    if isinstance(exc, (SourceError, llm.ModelError)):
        return str(exc)
    text = str(exc)
    if "Connect" in type(exc).__name__ or "Connection refused" in text or "connect" in text.lower():
        return f"Can't reach Ollama at {settings.ollama_host}. Is the Ollama app running?"
    return f"Unexpected error: {text or type(exc).__name__}"


# ── HTTP ─────────────────────────────────────────────────────────


@app.get("/api/health")
def health() -> dict:
    return {
        "status": "ok",
        "model": settings.ollama_model,
        "ollama": llm.model_status(),
        "github_token": bool(settings.github_token),
        "auth_required": bool(settings.api_token),
        "limits": {"max_files": settings.max_files, "max_file_chars": settings.max_file_chars},
    }


@app.get("/api/state")
def get_state(
    x_session_id: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> dict:
    return _http_session(x_session_id, authorization).snapshot()


@app.delete("/api/state")
def reset_state(
    x_session_id: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> dict:
    session = _http_session(x_session_id, authorization)
    if session.busy:
        raise HTTPException(409, "Stop the running task first")
    session.reset()
    return session.snapshot()


# ── WebSocket ────────────────────────────────────────────────────


def _start_run(session: Session, kind: str, label: str, work) -> None:
    """Run `work(cancel)` as the session's single background task.

    `work` returns the Markdown reply (and optionally the tools used).
    Every run ends with a `run_finished` event, whatever happens.
    """
    if session.busy:
        session.emit({"type": "error", "message": "Still working on the last request. Wait, or press Stop."})
        return
    cancel = session.new_run()

    async def runner() -> None:
        session.emit({"type": "run_started", "kind": kind, "label": label})
        try:
            result = await work(cancel)
            reply, tools = result if isinstance(result, tuple) else (result, [])
            if kind != "chat":
                session.add_history("assistant", f"[{label}]\n{reply[:1500]}")
            session.emit({"type": "message", "kind": kind, "label": label, "content": reply, "tools": tools})
        except asyncio.CancelledError:
            cancel.set()
            session.emit({"type": "interrupted"})
            raise
        except Exception as exc:  # noqa: BLE001 - always report back to the UI
            if not isinstance(exc, (SourceError, llm.ModelError)):
                log.exception("%s failed", label)
            session.emit({"type": "error", "message": _friendly(exc)})
        finally:
            state = session.snapshot()
            state["busy"] = False
            session.emit({"type": "run_finished", "state": state})

    session.task = asyncio.create_task(runner())


def _thread(fn, *args, with_cancel: bool = False):
    """Wrap a blocking operation so it runs in a worker thread."""
    async def work(cancel):
        return await asyncio.to_thread(fn, *args, *((cancel,) if with_cancel else ()))
    return work


async def _handle(session: Session, msg: dict) -> None:
    kind = msg.get("type")

    if kind == "ping":
        session.emit({"type": "pong"})

    elif kind == "chat":
        text = str(msg.get("message", "")).strip()[:MAX_MESSAGE_CHARS]
        if text:
            _start_run(session, "chat", "Thinking", lambda cancel: run_chat(session, text))

    elif kind == "interrupt":
        session.cancel_event.set()
        if session.busy:
            session.task.cancel()

    elif kind == "command":
        name, args = msg.get("name"), msg.get("args") or {}
        if name == "load":
            source = str(args.get("source", "")).strip()
            _start_run(session, "command", "Loading repository", _thread(ops.load_source, session, source))
        elif name == "analyze":
            file_filter = str(args.get("filter") or "all")
            _start_run(session, "command", "Analyzing files", _thread(ops.analyze, session, file_filter, with_cancel=True))
        elif name == "create_fixes":
            severity = str(args.get("severity") or "all")
            file_filter = str(args.get("file") or "")
            async def preview(cancel):
                action = await asyncio.to_thread(ops.preview_create_fixes, session, severity, file_filter)
                session.request_action(action)
                return f"Review the plan below, then approve to start: **{action.title}**."
            _start_run(session, "command", "Preparing fixes", preview)
        elif name == "discard_fix":
            fix_id = str(args.get("fix_id", ""))
            _start_run(session, "command", "Discarding fix", _thread(ops.discard_fixes, session, [fix_id]))
        else:
            session.emit({"type": "error", "message": f"Unknown command: {name}"})

    elif kind == "confirm":
        action = session.pending.pop(str(msg.get("action_id", "")), None)
        if action is None:
            session.emit({"type": "error", "message": "That request has expired."})
            return
        session.emit({"type": "action_resolved", "action_id": action.id, "approved": bool(msg.get("approved"))})
        if not msg.get("approved"):
            session.add_history("assistant", f"[User rejected: {action.title}]")
            return

        async def execute(cancel):
            return await asyncio.to_thread(ops.run_action, session, action, cancel)
        _start_run(session, "action", action.title, execute)


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket) -> None:
    # Browsers don't apply CORS to WebSockets, so check the Origin header ourselves.
    # Without this, any website you visit could drive the agent.
    origin = (ws.headers.get("origin") or "").rstrip("/")
    if origin not in settings.allowed_origins or not _token_ok(ws.query_params.get("token")):
        await ws.close(code=1008)
        return
    try:
        session = sessions.get(ws.query_params.get("session", ""))
    except ValueError:
        await ws.close(code=1008)
        return

    await ws.accept()
    outbox: asyncio.Queue = asyncio.Queue()
    session.attach(asyncio.get_running_loop(), outbox)

    async def writer() -> None:
        while True:
            await ws.send_json(await outbox.get())

    writer_task = asyncio.create_task(writer())
    session.emit({"type": "hello", "state": session.snapshot(), "model": settings.ollama_model})
    try:
        while True:
            msg = await ws.receive_json()
            if isinstance(msg, dict):
                await _handle(session, msg)
    except (WebSocketDisconnect, RuntimeError):
        pass
    except ValueError:  # invalid JSON
        await ws.close(code=1003)
    finally:
        # A running task keeps going; reconnecting with the same session picks it back up.
        session.detach(outbox)
        writer_task.cancel()


# Serve the built frontend when it exists, so production is one process.
_dist = Path(__file__).resolve().parents[2] / "frontend" / "dist"
if _dist.is_dir():
    app.mount("/", StaticFiles(directory=_dist, html=True), name="frontend")
