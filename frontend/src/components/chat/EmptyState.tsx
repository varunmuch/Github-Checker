import { FolderGit2, ScanSearch, ShieldCheck, WandSparkles } from 'lucide-react'
import { useApp } from '@/state/context'
import { Logo } from '@/components/ui/Brand'
import { SourceForm } from '@/components/sidebar/SourceForm'

const STEPS = [
  { icon: FolderGit2, title: 'Load', text: 'A GitHub repo or a folder on this machine.' },
  { icon: ScanSearch, title: 'Review', text: 'The local model finds bugs, security issues and outdated APIs.' },
  { icon: WandSparkles, title: 'Fix', text: 'Get a pull request or git branch per file, after you approve.' },
]

export function EmptyState() {
  const { state } = useApp()
  const model = state.health?.model ?? state.model

  return (
    <div className="mx-auto flex min-h-full max-w-2xl flex-col justify-center px-1 py-10">
      <Logo className="size-11" />
      <h1 className="mt-5 text-2xl font-semibold tracking-tight text-fg sm:text-[28px]">Review code with a local model</h1>
      <p className="mt-2 max-w-lg text-[15px] leading-relaxed text-fg-muted">
        RepoScan finds problems in your code and prepares fixes. Everything runs on your machine,
        so no code is sent to an AI service.
      </p>

      <div className="mt-7">
        <SourceForm size="lg" autoFocus />
      </div>

      <ol className="mt-9 grid gap-3 sm:grid-cols-3">
        {STEPS.map(({ icon: Icon, title, text }, i) => (
          <li key={title} className="rounded-xl border border-border bg-panel p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-fg">
              <Icon className="size-4 text-accent-text" aria-hidden />
              <span className="text-fg-subtle">{i + 1}.</span> {title}
            </div>
            <p className="mt-1.5 text-[13px] leading-relaxed text-fg-muted">{text}</p>
          </li>
        ))}
      </ol>

      <p className="mt-6 flex items-center gap-2 text-xs text-fg-subtle">
        <ShieldCheck className="size-3.5" aria-hidden />
        Nothing is changed without your approval{model ? `. Model: ${model}` : ''}.
      </p>
    </div>
  )
}
