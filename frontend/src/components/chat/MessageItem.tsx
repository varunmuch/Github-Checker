import { CircleAlert, Info } from 'lucide-react'
import type { ChatItem } from '@/lib/types'
import { formatTime, toolLabel } from '@/lib/format'
import { Logo } from '@/components/ui/Brand'
import { ConfirmCard } from './ConfirmCard'
import { Markdown } from './Markdown'

export function MessageItem({ item }: { item: ChatItem }) {
  switch (item.type) {
    case 'user':
      return (
        <div className="animate-rise flex justify-end">
          <div className="max-w-[85%] rounded-2xl rounded-br-md bg-accent px-4 py-2.5 text-[14px] leading-relaxed whitespace-pre-wrap text-white shadow-sm sm:max-w-[75%]">
            {item.text}
          </div>
        </div>
      )

    case 'agent':
      return (
        <div className="animate-rise flex gap-3">
          <Logo className="mt-0.5 size-7" />
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg-subtle">
              <span className="font-medium text-fg-muted">{item.label?.replace(/`/g, '') ?? 'RepoScan'}</span>
              <span>{formatTime(item.at)}</span>
              {[...new Set(item.tools)].map(tool => (
                <span key={tool} className="rounded-md border border-border bg-panel-2 px-1.5 py-px text-[11px] text-fg-muted">
                  {toolLabel(tool)}
                </span>
              ))}
            </div>
            <Markdown>{item.text}</Markdown>
          </div>
        </div>
      )

    case 'error':
      return (
        <div role="alert" className="animate-rise flex items-start gap-2.5 rounded-xl border border-danger/30 bg-danger-soft px-3.5 py-2.5 text-[13.5px] text-fg">
          <CircleAlert className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
          <span className="leading-relaxed">{item.text}</span>
        </div>
      )

    case 'notice':
      return (
        <div className="animate-rise flex items-center justify-center gap-1.5 text-xs text-fg-subtle">
          <Info className="size-3.5" aria-hidden />
          {item.text}
        </div>
      )

    case 'confirm':
      return <ConfirmCard item={item} />
  }
}
