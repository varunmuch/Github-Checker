import { clsx } from 'clsx'
import { ArrowRight } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useApp } from '@/state/context'
import { Button } from '@/components/ui/Button'

interface Props {
  size?: 'md' | 'lg'
  autoFocus?: boolean
  onSubmitted?: () => void
}

export function SourceForm({ size = 'md', autoFocus, onSubmitted }: Props) {
  const { state, actions } = useApp()
  const [value, setValue] = useState('')
  const busy = !!state.run
  const disabled = busy || state.connection !== 'open'

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const source = value.trim()
    if (!source || disabled) return
    actions.runCommand({ name: 'load', args: { source } })
    setValue('')
    onSubmitted?.()
  }

  const large = size === 'lg'
  return (
    <form onSubmit={submit} className={clsx('flex gap-2', large ? 'flex-col sm:flex-row' : 'flex-col')}>
      <label className="sr-only" htmlFor={`source-${size}`}>GitHub URL or local folder path</label>
      <input
        id={`source-${size}`}
        value={value}
        onChange={e => setValue(e.target.value)}
        autoFocus={autoFocus}
        spellCheck={false}
        autoComplete="off"
        placeholder={large ? 'https://github.com/owner/repo  or  /Users/you/project' : 'GitHub URL or folder path'}
        className={clsx(
          'w-full min-w-0 rounded-lg border border-border bg-panel font-mono text-fg placeholder:font-sans placeholder:text-fg-subtle',
          'transition-colors focus:border-accent focus:outline-none focus:ring-3 focus:ring-accent-soft',
          large ? 'h-11 px-3.5 text-[13.5px]' : 'h-9 px-3 text-[12.5px]',
        )}
      />
      <Button
        type="submit"
        variant="primary"
        disabled={disabled || !value.trim()}
        className={large ? 'h-11 px-5' : 'w-full'}
        icon={<ArrowRight className="size-4" aria-hidden />}
      >
        Load
      </Button>
    </form>
  )
}
