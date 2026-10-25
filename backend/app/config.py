"""Runtime settings, read once from environment variables (and backend/.env)."""

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")


def _int(name: str, default: int) -> int:
    raw = os.getenv(name, "").strip()
    try:
        return int(raw) if raw else default
    except ValueError:
        return default


def _list(name: str, default: str) -> list[str]:
    raw = os.getenv(name, default)
    return [item.strip().rstrip("/") for item in raw.split(",") if item.strip()]


@dataclass
class Settings:
    # Local model served by Ollama. Nothing is sent to a cloud AI provider.
    ollama_host: str
    ollama_model: str
    ollama_num_ctx: int
    # Optional. Needed to open PRs, and raises GitHub's rate limit for reads.
    github_token: str
    # Local folders may only be scanned inside these directories.
    local_roots: list[str]
    # Browser origins allowed to call the API and open the WebSocket.
    allowed_origins: list[str]
    # Optional shared secret. When set, every request must send it.
    api_token: str
    # Upper bound on files reviewed in one analysis run.
    max_files: int
    # Larger files are skipped so the model always sees whole files.
    max_file_chars: int
    # Parallel file reviews. Keep at 1 unless Ollama runs with OLLAMA_NUM_PARALLEL > 1.
    concurrency: int
    # Chat messages kept as agent context.
    history_limit: int


settings = Settings(
    ollama_host=os.getenv("OLLAMA_HOST", "http://localhost:11434").strip().rstrip("/"),
    ollama_model=os.getenv("OLLAMA_MODEL", "qwen3.5:9b").strip() or "qwen3.5:9b",
    ollama_num_ctx=_int("OLLAMA_NUM_CTX", 32_768),
    github_token=os.getenv("GITHUB_TOKEN", "").strip(),
    local_roots=_list("LOCAL_ROOTS", str(Path.home())),
    allowed_origins=_list("ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173,http://localhost:8000,http://127.0.0.1:8000"),
    api_token=os.getenv("REPOSCAN_API_TOKEN", "").strip(),
    max_files=_int("MAX_FILES", 25),
    max_file_chars=_int("MAX_FILE_CHARS", 24_000),
    concurrency=max(1, _int("ANALYZE_CONCURRENCY", 1)),
    history_limit=_int("HISTORY_LIMIT", 20),
)
