import { clsx } from 'clsx'
import { SEVERITY_LABEL } from '@/lib/format'
import { SEVERITY_BG, SEVERITY_TEXT } from '@/lib/severity'
import type { Severity } from '@/lib/types'

export function SeverityDot({ severity, className }: { severity: Severity; className?: string }) {
  return <span aria-hidden className={clsx('inline-block size-2 shrink-0 rounded-full', SEVERITY_BG[severity], className)} />
}

export function SeverityBadge({ severity }: { severity: Severity }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-full border border-current/25 px-2 py-0.5 text-[11px] font-semibold tracking-wide uppercase',
        SEVERITY_TEXT[severity],
      )}
    >
      <SeverityDot severity={severity} />
      {SEVERITY_LABEL[severity]}
    </span>
  )
}
