export type Severity = 'critical' | 'high' | 'medium' | 'low'

export interface Issue {
  id: number
  file: string
  title: string
  severity: Severity
  line: number | null
  description: string
  status: 'open' | 'fixed'
}

export interface Fix {
  id: string
  kind: 'pr' | 'branch'
  url: string | null
  number: number | null
  branch: string
  commit?: string
  /** Set when the PR was opened from the user's fork. */
  head_repo?: string | null
  file: string
  title: string
  summary: string
  severity: Severity
  issue_ids: number[]
  edits: number
}

export interface SourceInfo {
  kind: 'github' | 'local'
  label: string
  location: string
  branch: string
  commit: string
  file_count: number
  write_blocker: string | null
  /** direct: push to the repo · fork: PR from the user's fork · branch: local git branch · null: read only */
  write_mode: 'direct' | 'fork' | 'branch' | null
  fork: string | null
  notes: string[]
}

export interface Analysis {
  reviewed: number
  skipped: { path: string; reason: string }[]
  errors: number
  cancelled: boolean
  overflow: number
  at: number
}

export interface PendingAction {
  id: string
  kind: string
  title: string
  details: string[]
  destructive: boolean
}

export interface Snapshot {
  source: SourceInfo | null
  issues: Issue[]
  fixes: Fix[]
  analysis: Analysis | null
  pending: PendingAction[]
  busy: boolean
}

export interface Health {
  status: string
  model: string
  ollama: { ok: boolean; reason?: 'ollama_unreachable' | 'model_missing'; detail?: string }
  github_token: boolean
  auth_required: boolean
  limits: { max_files: number; max_file_chars: number }
}

export interface Progress {
  phase: 'analyze' | 'fix'
  done: number
  total: number
  current: string | null
}

export interface Run {
  kind: 'chat' | 'command' | 'action'
  startedAt: number
  label: string
  tools: string[]
  progress: Progress | null
}

export type ChatItem =
  | { type: 'user'; id: string; text: string; at: number }
  | { type: 'agent'; id: string; text: string; tools: string[]; label: string | null; at: number }
  | { type: 'error'; id: string; text: string; at: number }
  | { type: 'notice'; id: string; text: string; at: number }
  | { type: 'confirm'; id: string; action: PendingAction; status: 'pending' | 'approved' | 'rejected'; at: number }

/** Messages the server sends over the WebSocket. */
export type ServerEvent =
  | { type: 'hello'; state: Snapshot; model: string }
  | { type: 'run_started'; kind: Run['kind']; label: string }
  | { type: 'tool_call'; tool: string; args: Record<string, unknown> }
  | { type: 'progress' } & Progress
  | { type: 'confirm_request'; action: PendingAction }
  | { type: 'action_resolved'; action_id: string; approved: boolean }
  | { type: 'message'; kind: Run['kind']; label: string; content: string; tools: string[] }
  | { type: 'error'; message: string }
  | { type: 'interrupted' }
  | { type: 'run_finished'; state: Snapshot }
  | { type: 'pong' }

export type Command =
  | { name: 'load'; args: { source: string } }
  | { name: 'analyze'; args: { filter: string } }
  | { name: 'create_fixes'; args: { severity: Severity | 'all'; file?: string } }
  | { name: 'discard_fix'; args: { fix_id: string } }
