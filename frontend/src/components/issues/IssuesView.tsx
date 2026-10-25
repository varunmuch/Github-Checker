import { clsx } from 'clsx'
import { Bug, ChevronRight, CircleCheck, FileCode, Search, WandSparkles } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useApp } from '@/state/context'
import { SEVERITIES, SEVERITY_LABEL, basename, dirname } from '@/lib/format'
import type { Issue, Severity } from '@/lib/types'
import { Button } from '@/components/ui/Button'
import { SeverityBadge, SeverityDot } from '@/components/ui/Severity'
import { Markdown } from '@/components/chat/Markdown'

function IssueRow({ issue }: { issue: Issue }) {
  const [open, setOpen] = useState(false)
  return (
    <li className="border-t border-border first:border-t-0">
      <button
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-panel-2"
      >
        <ChevronRight className={clsx('mt-0.5 size-4 shrink-0 text-fg-subtle transition-transform', open && 'rotate-90')} aria-hidden />
        <SeverityDot severity={issue.severity} className="mt-1.5" />
        <div className="min-w-0 flex-1">
          <div className="text-[13.5px] font-medium text-fg">{issue.title}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-fg-subtle">
            <span className="font-mono">#{issue.id}</span>
            {issue.line && <span className="font-mono">line {issue.line}</span>}
            {issue.status === 'fixed' && (
              <span className="inline-flex items-center gap-1 text-success">
                <CircleCheck className="size-3.5" aria-hidden /> Fix created
              </span>
            )}
          </div>
        </div>
        <span className="hidden sm:block"><SeverityBadge severity={issue.severity} /></span>
      </button>
      {open && (
        <div className="px-4 pb-4 pl-[60px] text-[13.5px] text-fg-muted">
          <Markdown>{issue.description || 'No further details.'}</Markdown>
        </div>
      )}
    </li>
  )
}

export function IssuesView({ onAction }: { onAction: () => void }) {
  const { state, actions } = useApp()
  const { issues, source } = state.snapshot
  const [severity, setSeverity] = useState<Severity | 'all'>('all')
  const [query, setQuery] = useState('')
  const [hideFixed, setHideFixed] = useState(false)

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = issues.filter(i =>
      (severity === 'all' || i.severity === severity)
      && (!hideFixed || i.status === 'open')
      && (!q || i.title.toLowerCase().includes(q) || i.file.toLowerCase().includes(q)),
    )
    const byFile = new Map<string, Issue[]>()
    for (const issue of filtered) byFile.set(issue.file, [...(byFile.get(issue.file) ?? []), issue])
    return [...byFile.entries()]
  }, [issues, severity, query, hideFixed])

  if (issues.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
        <Bug className="size-8 text-fg-subtle" aria-hidden />
        <div className="text-[15px] font-medium text-fg">No issues yet</div>
        <p className="max-w-sm text-sm text-fg-muted">
          {source ? 'Run an analysis from the panel to review the code.' : 'Load a repository or folder to get started.'}
        </p>
      </div>
    )
  }

  const canFix = !!source && !source.write_blocker && !state.run && state.connection === 'open'

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3 sm:px-6">
        <div className="flex flex-wrap gap-1" role="group" aria-label="Filter by severity">
          {(['all', ...SEVERITIES] as const).map(s => {
            const count = s === 'all' ? issues.length : issues.filter(i => i.severity === s).length
            return (
              <button
                key={s}
                onClick={() => setSeverity(s)}
                aria-pressed={severity === s}
                className={clsx(
                  'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
                  severity === s ? 'border-accent bg-accent-soft text-accent-text' : 'border-border text-fg-muted hover:text-fg',
                )}
              >
                {s !== 'all' && <SeverityDot severity={s} />}
                {s === 'all' ? 'All' : SEVERITY_LABEL[s]}
                <span className="font-mono tabular-nums opacity-70">{count}</span>
              </button>
            )
          })}
        </div>
        <label className="ml-auto inline-flex items-center gap-2 text-xs text-fg-muted">
          <input type="checkbox" checked={hideFixed} onChange={e => setHideFixed(e.target.checked)} className="accent-[var(--accent)]" />
          Hide fixed
        </label>
        <div className="relative w-full sm:w-56">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-fg-subtle" aria-hidden />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search issues or files"
            aria-label="Search issues"
            className="h-8 w-full rounded-md border border-border bg-panel pr-2.5 pl-8 text-xs text-fg placeholder:text-fg-subtle focus:border-accent focus:outline-none"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-5 sm:px-6">
        <div className="mx-auto max-w-4xl space-y-4">
          {groups.length === 0 && <p className="py-10 text-center text-sm text-fg-muted">No issues match these filters.</p>}
          {groups.map(([file, fileIssues]) => {
            const open = fileIssues.filter(i => i.status === 'open')
            return (
              <section key={file} className="overflow-hidden rounded-xl border border-border bg-panel">
                <header className="flex items-center gap-2 border-b border-border bg-panel-2 px-4 py-2.5">
                  <FileCode className="size-4 shrink-0 text-fg-subtle" aria-hidden />
                  <h3 className="min-w-0 truncate font-mono text-[12.5px]" title={file}>
                    <span className="text-fg-subtle">{dirname(file)}</span>
                    <span className="font-medium text-fg">{basename(file)}</span>
                  </h3>
                  <span className="text-xs text-fg-subtle">{fileIssues.length}</span>
                  {open.length > 0 && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="ml-auto h-7"
                      disabled={!canFix}
                      title={source?.write_blocker ?? undefined}
                      onClick={() => { actions.runCommand({ name: 'create_fixes', args: { severity: 'all', file } }); onAction() }}
                      icon={<WandSparkles className="size-3.5" aria-hidden />}
                    >
                      Fix file
                    </Button>
                  )}
                </header>
                <ul>{fileIssues.map(issue => <IssueRow key={issue.id} issue={issue} />)}</ul>
              </section>
            )
          })}
        </div>
      </div>
    </div>
  )
}
