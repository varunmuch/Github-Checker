import { clsx } from 'clsx'
import { Menu, Moon, RotateCcw, Sun } from 'lucide-react'
import { useState } from 'react'
import { useApp } from '@/state/context'
import { IconButton } from '@/components/ui/Button'

export type Tab = 'chat' | 'issues' | 'fixes'

function useTheme() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const forced = document.documentElement.dataset.theme
    if (forced === 'light' || forced === 'dark') return forced
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
  })
  const toggle = () => {
    const next = theme === 'dark' ? 'light' : 'dark'
    document.documentElement.dataset.theme = next
    try { localStorage.setItem('reposcan.theme', next) } catch { /* private mode */ }
    setTheme(next)
  }
  return { theme, toggle }
}

export function TopBar({ tab, onTab, onMenu }: { tab: Tab; onTab: (t: Tab) => void; onMenu: () => void }) {
  const { state, actions } = useApp()
  const { theme, toggle } = useTheme()
  const { issues, fixes } = state.snapshot
  const openIssues = issues.filter(i => i.status === 'open').length

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: 'chat', label: 'Chat' },
    { id: 'issues', label: 'Issues', count: openIssues },
    { id: 'fixes', label: 'Fixes', count: fixes.length },
  ]

  const status =
    state.connection !== 'open'
      ? { label: state.connection === 'connecting' ? 'Connecting' : 'Offline', dot: 'bg-warning' }
      : state.run
        ? { label: 'Working', dot: 'bg-accent animate-pulse' }
        : { label: 'Ready', dot: 'bg-success' }

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border bg-panel/80 px-3 backdrop-blur sm:px-4">
      <IconButton label="Open panel" onClick={onMenu} className="lg:hidden">
        <Menu className="size-4.5" />
      </IconButton>

      <nav className="flex h-full items-stretch gap-1" aria-label="Views">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => onTab(t.id)}
            aria-current={tab === t.id ? 'page' : undefined}
            className={clsx(
              'relative inline-flex items-center gap-1.5 px-2.5 text-sm font-medium transition-colors sm:px-3',
              tab === t.id ? 'text-fg' : 'text-fg-subtle hover:text-fg-muted',
            )}
          >
            {t.label}
            {!!t.count && (
              <span className={clsx(
                'rounded-full px-1.5 py-px font-mono text-[11px] tabular-nums',
                tab === t.id ? 'bg-accent-soft text-accent-text' : 'bg-panel-2 text-fg-subtle',
              )}>
                {t.count}
              </span>
            )}
            {tab === t.id && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-accent" />}
          </button>
        ))}
      </nav>

      <div className="ml-auto flex items-center gap-1">
        <span className="mr-2 hidden items-center gap-2 text-xs text-fg-muted sm:inline-flex" role="status">
          <span className={clsx('size-2 rounded-full', status.dot)} />
          {status.label}
        </span>
        <IconButton label={theme === 'dark' ? 'Light theme' : 'Dark theme'} onClick={toggle}>
          {theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </IconButton>
        <IconButton label="New session" onClick={actions.newSession} disabled={!!state.run}>
          <RotateCcw className="size-4" />
        </IconButton>
      </div>
    </header>
  )
}
