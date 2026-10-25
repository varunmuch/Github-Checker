import { clsx } from 'clsx'
import { ArrowUp } from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useApp } from '@/state/context'

const MAX_CHARS = 4000

export function Composer({ suggestions }: { suggestions: string[] }) {
  const { state, actions } = useApp()
  const [value, setValue] = useState('')
  const ref = useRef<HTMLTextAreaElement>(null)
  const busy = !!state.run
  const offline = state.connection !== 'open'
  const canSend = !busy && !offline && value.trim().length > 0

  // Grow with content, up to a limit.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`
  }, [value])

  const send = () => {
    if (!canSend) return
    actions.sendChat(value.trim())
    setValue('')
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      send()
    }
  }

  return (
    <div className="border-t border-border bg-bg px-3 pt-2 pb-3 sm:px-6 sm:pb-4">
      <div className="mx-auto max-w-3xl">
        {suggestions.length > 0 && (
          <div className="-mx-1 mb-2 flex gap-1.5 overflow-x-auto px-1 pb-1">
            {suggestions.map(s => (
              <button
                key={s}
                disabled={busy || offline}
                onClick={() => { setValue(s); ref.current?.focus() }}
                className="shrink-0 rounded-full border border-border bg-panel px-3 py-1 text-xs text-fg-muted transition-colors hover:border-border-strong hover:text-fg disabled:opacity-40"
              >
                {s}
              </button>
            ))}
          </div>
        )}
        <div className={clsx(
          'flex items-end gap-2 rounded-2xl border bg-panel p-1.5 pl-3.5 transition-colors',
          'border-border focus-within:border-accent focus-within:ring-3 focus-within:ring-accent-soft',
        )}>
          <label htmlFor="composer" className="sr-only">Message RepoScan</label>
          <textarea
            id="composer"
            ref={ref}
            rows={1}
            value={value}
            maxLength={MAX_CHARS}
            onChange={e => setValue(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={busy ? 'Working… you can type your next message' : 'Ask about the code, issues or pull requests'}
            className="max-h-[180px] flex-1 resize-none bg-transparent py-2 text-[14px] leading-relaxed text-fg placeholder:text-fg-subtle focus:outline-none focus-visible:outline-none"
          />
          <button
            onClick={send}
            disabled={!canSend}
            aria-label="Send message"
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent text-white transition-colors hover:bg-accent-hover disabled:bg-panel-2 disabled:text-fg-subtle"
          >
            <ArrowUp className="size-4.5" />
          </button>
        </div>
        <p className="mt-1.5 hidden text-center text-[11px] text-fg-subtle sm:block">
          Answers come from a local model and can be wrong. Changes always wait for your approval.
        </p>
      </div>
    </div>
  )
}
