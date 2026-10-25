import { LoaderCircle, Square } from 'lucide-react'
import { useApp } from '@/state/context'
import { toolLabel } from '@/lib/format'
import { Button } from '@/components/ui/Button'

/** Live status of the current task: what it's doing, progress, and a Stop button. */
export function RunStatus() {
  const { state, actions } = useApp()
  const run = state.run
  if (!run) return null

  const progress = run.progress
  const lastTool = run.tools.at(-1)
  const title = progress
    ? progress.phase === 'analyze' ? 'Reviewing files' : 'Writing fixes'
    : lastTool ? toolLabel(lastTool) : run.label
  const pct = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : null

  return (
    <div className="animate-rise rounded-xl border border-border bg-panel p-3.5" role="status" aria-live="polite">
      <div className="flex items-center gap-3">
        <LoaderCircle className="size-4 shrink-0 animate-spin text-accent" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="text-[13.5px] font-medium text-fg">
            {title}
            {progress && progress.total > 0 && (
              <span className="ml-2 font-mono text-xs font-normal text-fg-subtle tabular-nums">
                {progress.done}/{progress.total}
              </span>
            )}
          </div>
          {progress?.current && (
            <div className="truncate font-mono text-xs text-fg-subtle" title={progress.current}>{progress.current}</div>
          )}
          {!progress && run.tools.length > 1 && (
            <div className="truncate text-xs text-fg-subtle">
              {run.tools.slice(0, -1).map(toolLabel).join(' → ')}
            </div>
          )}
        </div>
        <Button size="sm" variant="ghost" onClick={actions.interrupt} icon={<Square className="size-3 fill-current" aria-hidden />}>
          Stop
        </Button>
      </div>
      <div className="mt-3 h-1 overflow-hidden rounded-full bg-panel-2">
        {pct === null ? (
          <div className="animate-indeterminate h-full w-2/5 rounded-full bg-accent/70" />
        ) : (
          <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${Math.max(pct, 3)}%` }} />
        )}
      </div>
      {progress?.phase && (
        <p className="mt-2 text-[11.5px] text-fg-subtle">
          Running on your machine. Each file can take 10 to 60 seconds, depending on its size.
        </p>
      )}
    </div>
  )
}
