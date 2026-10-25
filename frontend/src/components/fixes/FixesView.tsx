import { Check, Copy, ExternalLink, GitBranch, GitPullRequest, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { useApp } from '@/state/context'
import type { Fix } from '@/lib/types'
import { Button } from '@/components/ui/Button'
import { SeverityBadge } from '@/components/ui/Severity'
import { Markdown } from '@/components/chat/Markdown'

function CopyCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error('Could not copy to the clipboard')
    }
  }
  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-panel-2 py-1 pr-1 pl-2.5">
      <code className="min-w-0 flex-1 truncate font-mono text-xs text-fg-muted">{command}</code>
      <button onClick={copy} className="rounded p-1 text-fg-subtle hover:bg-elev hover:text-fg" aria-label={`Copy: ${command}`}>
        {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
      </button>
    </div>
  )
}

function FixCard({ fix }: { fix: Fix }) {
  const { state, actions } = useApp()
  const [confirming, setConfirming] = useState(false)
  const base = state.snapshot.source?.branch || 'main'
  const isPR = fix.kind === 'pr'

  return (
    <article className="rounded-xl border border-border bg-panel p-4">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 rounded-lg bg-success-soft p-1.5 text-success">
          {isPR ? <GitPullRequest className="size-4" aria-hidden /> : <GitBranch className="size-4" aria-hidden />}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[14px] font-semibold text-fg">{fix.title}</h3>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-subtle">
            <SeverityBadge severity={fix.severity} />
            <span className="font-mono">{fix.file}</span>
            <span>{fix.issue_ids.length} issue{fix.issue_ids.length === 1 ? '' : 's'} · {fix.edits} edit{fix.edits === 1 ? '' : 's'}</span>
            {fix.head_repo && <span>from your fork <span className="font-mono">{fix.head_repo}</span></span>}
          </div>
        </div>
        {isPR && fix.url && (
          <a
            href={fix.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-fg hover:border-border-strong"
          >
            PR #{fix.number} <ExternalLink className="size-3.5" aria-hidden />
          </a>
        )}
      </div>

      {fix.summary && <div className="mt-3 text-[13px] text-fg-muted"><Markdown>{fix.summary}</Markdown></div>}

      {!isPR && (
        <div className="mt-3 space-y-1.5">
          <CopyCommand command={`git diff ${base}...${fix.branch}`} />
          <CopyCommand command={`git merge ${fix.branch}`} />
        </div>
      )}

      <div className="mt-3 flex items-center justify-end gap-2 border-t border-border pt-3">
        <span className="mr-auto truncate font-mono text-xs text-fg-subtle">{fix.branch}</span>
        {confirming ? (
          <>
            <span className="text-xs text-fg-muted">{isPR ? 'Close PR and delete branch?' : 'Delete this branch?'}</span>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>Keep</Button>
            <Button
              size="sm"
              variant="danger"
              disabled={!!state.run}
              onClick={() => { setConfirming(false); actions.runCommand({ name: 'discard_fix', args: { fix_id: fix.id } }) }}
            >
              Discard
            </Button>
          </>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => setConfirming(true)} icon={<Trash2 className="size-3.5" aria-hidden />}>
            Discard
          </Button>
        )}
      </div>
    </article>
  )
}

export function FixesView() {
  const { state } = useApp()
  const { fixes, source } = state.snapshot

  if (fixes.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
        <GitPullRequest className="size-8 text-fg-subtle" aria-hidden />
        <div className="text-[15px] font-medium text-fg">No fixes yet</div>
        <p className="max-w-sm text-sm text-fg-muted">
          After an analysis, use <span className="font-medium text-fg">Create fixes</span>. Each fixed file becomes
          {source?.kind === 'local' ? ' its own git branch.' : ' its own pull request.'}
        </p>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-5 sm:px-6">
      <div className="mx-auto max-w-3xl space-y-3">
        {source?.kind === 'local' && (
          <p className="text-[13px] text-fg-muted">
            Fixes are saved as branches in <span className="font-mono text-fg">{source.location}</span>. Your working copy is untouched.
          </p>
        )}
        {fixes.map(fix => <FixCard key={fix.id} fix={fix} />)}
      </div>
    </div>
  )
}
