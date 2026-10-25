import { clsx } from 'clsx'
import {
  Cpu, ExternalLink, FolderGit2, GitBranch, Play, TriangleAlert, WandSparkles, X,
} from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useApp } from '@/state/context'
import { SEVERITIES, SEVERITY_LABEL } from '@/lib/format'
import { SEVERITY_BG } from '@/lib/severity'
import type { Severity } from '@/lib/types'
import { Button } from '@/components/ui/Button'
import { GitHubMark, Logo } from '@/components/ui/Brand'
import { SourceForm } from './SourceForm'

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="border-b border-border px-4 py-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[11px] font-semibold tracking-[0.08em] text-fg-subtle uppercase">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}

function SourceSection({ onAction, heroVisible }: { onAction: () => void; heroVisible: boolean }) {
  const { state } = useApp()
  const [changing, setChanging] = useState(false)
  const source = state.snapshot.source

  if (!source && heroVisible) {
    return (
      <Section title="Source">
        <div className="rounded-lg border border-dashed border-border-strong px-3 py-4 text-center text-xs leading-relaxed text-fg-subtle">
          Nothing loaded yet. Paste a GitHub URL or folder path to start.
        </div>
      </Section>
    )
  }

  if (!source || changing) {
    return (
      <Section
        title="Source"
        action={changing && (
          <button className="text-xs text-fg-muted hover:text-fg" onClick={() => setChanging(false)}>Cancel</button>
        )}
      >
        <SourceForm autoFocus={changing} onSubmitted={() => { setChanging(false); onAction() }} />
        <p className="mt-2 text-xs leading-relaxed text-fg-subtle">
          A GitHub repo, <span className="font-mono">owner/repo</span>, or an absolute path to a folder on this machine.
        </p>
      </Section>
    )
  }

  const isGitHub = source.kind === 'github'
  return (
    <Section
      title="Source"
      action={
        <button className="text-xs font-medium text-accent-text hover:underline disabled:opacity-50" disabled={!!state.run} onClick={() => setChanging(true)}>
          Change
        </button>
      }
    >
      <div className="rounded-lg border border-border bg-panel-2 p-3">
        <div className="flex items-start gap-2.5">
          <span className="mt-0.5 text-fg-muted">
            {isGitHub ? <GitHubMark /> : <FolderGit2 className="size-4" aria-hidden />}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="truncate font-mono text-[13px] font-medium text-fg" title={source.location}>{source.label}</span>
              {isGitHub && (
                <a href={source.location} target="_blank" rel="noreferrer" className="text-fg-subtle hover:text-fg" aria-label="Open on GitHub">
                  <ExternalLink className="size-3.5" />
                </a>
              )}
            </div>
            {!isGitHub && <div className="truncate text-[11.5px] text-fg-subtle" title={source.location}>{source.location}</div>}
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-muted">
              {source.branch && (
                <span className="inline-flex items-center gap-1">
                  <GitBranch className="size-3.5" aria-hidden />
                  <span className="font-mono">{source.branch}</span>
                  {source.commit && <span className="font-mono text-fg-subtle">@{source.commit}</span>}
                </span>
              )}
              <span>{source.file_count.toLocaleString()} files</span>
            </div>
            <AccessBadge mode={source.write_mode} kind={source.kind} />
          </div>
        </div>
      </div>
      {source.notes.map(note => (
        <div key={note} className="mt-2 flex gap-2 rounded-md bg-warning-soft px-2.5 py-2 text-xs leading-relaxed text-warning">
          <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
          <span>{note}</span>
        </div>
      ))}
    </Section>
  )
}

const ACCESS: Record<string, { label: string; className: string; title: string }> = {
  direct: { label: 'Write access', className: 'bg-success-soft text-success', title: 'Fixes are opened as pull requests from branches in this repo.' },
  fork: { label: 'PRs from your fork', className: 'bg-accent-soft text-accent-text', title: "You can't push here, so fixes are opened from your fork." },
  branch: { label: 'Fixes as local branches', className: 'bg-success-soft text-success', title: 'Each fix is committed to a new git branch.' },
  none: { label: 'Read only', className: 'bg-panel text-fg-subtle border border-border', title: 'You can review this code, but fixes are unavailable.' },
}

function AccessBadge({ mode, kind }: { mode: string | null; kind: string }) {
  const access = ACCESS[mode ?? 'none']
  if (!mode && kind === 'local') return null // the notes already explain this
  return (
    <span title={access.title} className={clsx('mt-2 inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium', access.className)}>
      {access.label}
    </span>
  )
}

function ActionsSection({ onAction }: { onAction: () => void }) {
  const { state, actions } = useApp()
  const { source, issues } = state.snapshot
  const [filter, setFilter] = useState('')
  const [severity, setSeverity] = useState<Severity | 'all'>('all')
  if (!source) return null

  const busy = !!state.run || state.connection !== 'open'
  const modelDown = state.health ? !state.health.ollama.ok : false
  const openIssues = issues.filter(i => i.status === 'open' && (severity === 'all' || i.severity === severity))
  const fixNoun = source.write_mode === 'fork'
    ? 'pull requests from your fork'
    : source.kind === 'github' ? 'pull requests' : 'fix branches'

  return (
    <Section title="Actions">
      <form
        className="space-y-2"
        onSubmit={e => {
          e.preventDefault()
          actions.runCommand({ name: 'analyze', args: { filter: filter.trim() || 'all' } })
          onAction()
        }}
      >
        <label htmlFor="filter" className="block text-xs font-medium text-fg-muted">Review code</label>
        <div className="flex gap-2">
          <input
            id="filter"
            value={filter}
            onChange={e => setFilter(e.target.value)}
            placeholder="All files, or src/ or .py"
            spellCheck={false}
            className="h-8 min-w-0 flex-1 rounded-md border border-border bg-panel px-2.5 font-mono text-xs text-fg placeholder:font-sans placeholder:text-fg-subtle focus:border-accent focus:outline-none"
          />
          <Button type="submit" size="sm" variant="primary" disabled={busy || modelDown} icon={<Play className="size-3.5" aria-hidden />}>
            Analyze
          </Button>
        </div>
      </form>

      <div className="mt-4 space-y-2">
        <label htmlFor="severity" className="block text-xs font-medium text-fg-muted">Fix issues</label>
        <div className="flex gap-2">
          <select
            id="severity"
            value={severity}
            onChange={e => setSeverity(e.target.value as Severity | 'all')}
            className="h-8 min-w-0 flex-1 rounded-md border border-border bg-panel px-2 text-xs text-fg focus:border-accent focus:outline-none"
          >
            <option value="all">All severities</option>
            {SEVERITIES.map(s => <option key={s} value={s}>{SEVERITY_LABEL[s]} only</option>)}
          </select>
          <Button
            size="sm"
            disabled={busy || modelDown || !!source.write_blocker || openIssues.length === 0}
            onClick={() => { actions.runCommand({ name: 'create_fixes', args: { severity } }); onAction() }}
            icon={<WandSparkles className="size-3.5" aria-hidden />}
          >
            Create fixes
          </Button>
        </div>
        <p className="text-xs leading-relaxed text-fg-subtle">
          {source.write_blocker
            ?? (issues.length === 0
              ? 'Run an analysis first.'
              : `Opens ${fixNoun}, one per file. You approve the plan first.`)}
        </p>
      </div>
    </Section>
  )
}

function OverviewSection() {
  const { state } = useApp()
  const { issues, fixes, analysis } = state.snapshot
  if (!analysis && issues.length === 0) return null

  const counts = SEVERITIES.map(s => ({ s, n: issues.filter(i => i.severity === s).length }))
  const max = Math.max(1, ...counts.map(c => c.n))
  const fixed = issues.filter(i => i.status === 'fixed').length

  return (
    <Section title="Overview">
      <div className="mb-4 grid grid-cols-3 gap-2">
        <Stat label="Issues" value={issues.length} />
        <Stat label="Fixed" value={fixed} />
        <Stat label="Fixes" value={fixes.length} />
      </div>
      <ul className="space-y-2">
        {counts.map(({ s, n }) => (
          <li key={s} className="grid grid-cols-[64px_1fr_24px] items-center gap-2 text-xs">
            <span className="text-fg-muted">{SEVERITY_LABEL[s]}</span>
            <span className="h-1.5 overflow-hidden rounded-full bg-panel-2">
              <span className={clsx('block h-full rounded-full', SEVERITY_BG[s])} style={{ width: `${(n / max) * 100}%` }} />
            </span>
            <span className="text-right font-mono text-fg-muted tabular-nums">{n}</span>
          </li>
        ))}
      </ul>
      {analysis && (
        <p className="mt-3 text-xs text-fg-subtle">
          Last run reviewed {analysis.reviewed} file{analysis.reviewed === 1 ? '' : 's'}
          {analysis.skipped.length > 0 && `, skipped ${analysis.skipped.length}`}
          {analysis.errors > 0 && `, ${analysis.errors} failed`}
          {analysis.cancelled && ' (stopped early)'}.
        </p>
      )}
    </Section>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border bg-panel-2 px-2 py-2 text-center">
      <div className="font-mono text-lg leading-none font-semibold text-fg tabular-nums">{value}</div>
      <div className="mt-1 text-[10.5px] tracking-wide text-fg-subtle uppercase">{label}</div>
    </div>
  )
}

function StatusFooter() {
  const { state } = useApp()
  const health = state.health
  const ok = health?.ollama.ok
  return (
    <div className="mt-auto space-y-1.5 border-t border-border px-4 py-3 text-xs text-fg-muted">
      <div className="flex items-center gap-2">
        <Cpu className="size-3.5 text-fg-subtle" aria-hidden />
        <span className="truncate font-mono">{health?.model ?? state.model ?? '…'}</span>
        <span className="ml-auto inline-flex items-center gap-1.5">
          <span className={clsx('size-1.5 rounded-full', ok ? 'bg-success' : health ? 'bg-danger' : 'bg-fg-subtle')} />
          {ok ? 'Local model ready' : health ? 'Unavailable' : 'Checking'}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <GitHubMark className="size-3.5 text-fg-subtle" />
        <span>GitHub</span>
        <span className="ml-auto">{health?.github_token ? 'Token set' : 'Public repos only'}</span>
      </div>
    </div>
  )
}

export function Sidebar({ open, onClose, onAction, heroVisible }: { open: boolean; onClose: () => void; onAction: () => void; heroVisible: boolean }) {
  return (
    <>
      <div
        className={clsx('fixed inset-0 z-30 bg-black/50 transition-opacity lg:hidden', open ? 'opacity-100' : 'pointer-events-none opacity-0')}
        onClick={onClose}
        aria-hidden
      />
      <aside
        className={clsx(
          'fixed inset-y-0 left-0 z-40 flex w-[300px] max-w-[85vw] flex-col border-r border-border bg-panel transition-transform',
          'lg:static lg:z-auto lg:translate-x-0',
          open ? 'translate-x-0 shadow-panel' : '-translate-x-full',
        )}
        aria-label="Repository panel"
      >
        <div className="flex h-14 shrink-0 items-center gap-2.5 border-b border-border px-4">
          <Logo />
          <div className="leading-tight">
            <div className="text-[15px] font-semibold tracking-tight">RepoScan</div>
            <div className="text-[11px] text-fg-subtle">Local AI code review</div>
          </div>
          <button className="ml-auto rounded-md p-1.5 text-fg-muted hover:bg-panel-2 lg:hidden" onClick={onClose} aria-label="Close panel">
            <X className="size-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          <SourceSection onAction={onAction} heroVisible={heroVisible} />
          <ActionsSection onAction={onAction} />
          <OverviewSection />
        </div>
        <StatusFooter />
      </aside>
    </>
  )
}
