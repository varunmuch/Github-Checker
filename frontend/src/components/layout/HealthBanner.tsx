import { CircleAlert } from 'lucide-react'
import type { ReactNode } from 'react'
import { useApp } from '@/state/context'
import { API_URL } from '@/lib/config'

function Code({ children }: { children: string }) {
  return <code className="rounded bg-panel-2 px-1.5 py-0.5 font-mono text-[12px]">{children}</code>
}

/** Explains what to do when the backend or the local model isn't available. */
export function HealthBanner() {
  const { state, actions } = useApp()
  const { health, connection } = state

  let message: ReactNode = null
  if (connection === 'closed' && !health) {
    message = <>Can't reach the RepoScan backend at <Code>{API_URL}</Code>. Start it with <Code>uvicorn app.main:app --port 8000</Code>.</>
  } else if (health && !health.ollama.ok) {
    message = health.ollama.reason === 'model_missing'
      ? <>The model <Code>{health.model}</Code> isn't downloaded yet. Run <Code>{`ollama pull ${health.model}`}</Code>.</>
      : <>Ollama isn't running. Open the Ollama app or run <Code>ollama serve</Code>.</>
  }
  if (!message) return null

  return (
    <div role="alert" className="flex items-start gap-2.5 border-b border-border bg-warning-soft px-4 py-2.5 text-[13px] text-fg">
      <CircleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
      <p className="flex-1 leading-relaxed">{message}</p>
      <button onClick={actions.refreshHealth} className="text-xs font-medium text-accent-text hover:underline">
        Check again
      </button>
    </div>
  )
}
