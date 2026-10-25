import { useEffect, useRef } from 'react'
import { useApp } from '@/state/context'
import { Composer } from './Composer'
import { EmptyState } from './EmptyState'
import { MessageItem } from './MessageItem'
import { RunStatus } from './RunStatus'

function useSuggestions(): string[] {
  const { state } = useApp()
  const { source, issues, fixes } = state.snapshot
  if (!source) return ['What can you do?', 'Load octocat/Hello-World']
  if (!state.snapshot.analysis) return ['Analyze all files', 'Analyze only the src folder', 'Which files will you review?']
  if (issues.length === 0) return ['Analyze a different folder', 'What did you check?']
  if (fixes.length === 0) return ['What is the most serious issue?', 'Explain issue 1', 'Fix the critical issues']
  return source.kind === 'github'
    ? ['Show open pull requests', 'Which fix should I review first?']
    : ['How do I review a fix branch?', 'Which fix should I review first?']
}

export function ChatView() {
  const { state } = useApp()
  const suggestions = useSuggestions()
  const scrollRef = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)

  // Keep the newest message in view unless the user has scrolled up to read.
  useEffect(() => {
    const el = scrollRef.current
    if (el && pinned.current) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [state.items, state.run])

  const onScroll = () => {
    const el = scrollRef.current
    if (el) pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }

  const empty = state.items.length === 0 && !state.snapshot.source && !state.run

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto px-4 sm:px-6">
        {empty ? (
          <EmptyState />
        ) : (
          <div className="mx-auto max-w-3xl space-y-5 py-6">
            {state.items.map(item => <MessageItem key={item.id} item={item} />)}
            <RunStatus />
          </div>
        )}
      </div>
      <Composer suggestions={suggestions} />
    </div>
  )
}
