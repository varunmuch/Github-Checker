import { clsx } from 'clsx'
import { Check, ShieldAlert, ShieldCheck, X } from 'lucide-react'
import { useApp } from '@/state/context'
import type { ChatItem } from '@/lib/types'
import { Button } from '@/components/ui/Button'
import { Markdown } from './Markdown'

type ConfirmItem = Extract<ChatItem, { type: 'confirm' }>

/** A write action waiting for the user's decision. Nothing runs until Approve. */
export function ConfirmCard({ item }: { item: ConfirmItem }) {
  const { state, actions } = useApp()
  const { action, status } = item
  const pending = status === 'pending'
  const Icon = action.destructive ? ShieldAlert : ShieldCheck

  return (
    <div
      className={clsx(
        'animate-rise overflow-hidden rounded-xl border bg-panel',
        pending ? (action.destructive ? 'border-danger/50' : 'border-accent/50') : 'border-border opacity-80',
      )}
    >
      <div className="flex items-start gap-3 px-4 pt-3.5">
        <span className={clsx(
          'mt-0.5 rounded-lg p-1.5',
          action.destructive ? 'bg-danger-soft text-danger' : 'bg-accent-soft text-accent-text',
        )}>
          <Icon className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-semibold tracking-wide text-fg-subtle uppercase">
            {pending ? 'Needs your approval' : status === 'approved' ? 'Approved' : 'Not approved'}
          </div>
          <div className="mt-0.5 text-[14px] font-semibold text-fg">
            <Markdown>{action.title}</Markdown>
          </div>
        </div>
      </div>

      <ul className="mx-4 mt-3 max-h-56 space-y-1 overflow-y-auto rounded-lg border border-border bg-panel-2 px-3 py-2 text-[13px]">
        {action.details.map(d => (
          <li key={d} className="md text-fg-muted [&_p]:m-0"><Markdown>{d}</Markdown></li>
        ))}
      </ul>

      {pending ? (
        <div className="flex flex-wrap items-center justify-end gap-2 px-4 py-3">
          <span className="mr-auto text-xs text-fg-subtle">
            {action.destructive ? 'This changes the repository and can be hard to undo.' : 'AI-written changes. Review them before merging.'}
          </span>
          <Button size="sm" variant="ghost" onClick={() => actions.confirm(action.id, false)} icon={<X className="size-3.5" aria-hidden />}>
            Reject
          </Button>
          <Button
            size="sm"
            variant={action.destructive ? 'danger' : 'primary'}
            disabled={!!state.run || state.connection !== 'open'}
            onClick={() => actions.confirm(action.id, true)}
            icon={<Check className="size-3.5" aria-hidden />}
          >
            Approve
          </Button>
        </div>
      ) : (
        <div className="h-3" />
      )}
    </div>
  )
}
