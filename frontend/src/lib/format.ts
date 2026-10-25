import type { Severity } from './types'

export const SEVERITIES: Severity[] = ['critical', 'high', 'medium', 'low']

export const SEVERITY_LABEL: Record<Severity, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
}

/** Friendly names for agent tools, shown while the agent works. */
export const TOOL_LABEL: Record<string, string> = {
  load_repo: 'Loading repository',
  analyze_files: 'Reviewing files',
  show_issues: 'Listing issues',
  explain_issue: 'Explaining issue',
  create_fixes: 'Planning fixes',
  discard_fixes: 'Planning cleanup',
  list_pull_requests: 'Listing pull requests',
  get_pull_request: 'Reading pull request',
  close_pull_request: 'Preparing to close PR',
  close_all_pull_requests: 'Preparing to close PRs',
  merge_pull_request: 'Preparing merge',
}

export function toolLabel(tool: string): string {
  return TOOL_LABEL[tool] ?? tool.replace(/_/g, ' ')
}

export function basename(path: string): string {
  return path.split('/').pop() ?? path
}

export function dirname(path: string): string {
  const parts = path.split('/')
  return parts.length > 1 ? parts.slice(0, -1).join('/') + '/' : ''
}

export function formatTime(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

export function uid(): string {
  return crypto.randomUUID()
}
