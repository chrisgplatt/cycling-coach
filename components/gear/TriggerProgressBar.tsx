import type { TriggerKind, TriggerMetric } from '@/types'
import type { TriggerStatus } from '@/lib/gear/usage'
import { fmtNum } from '@/lib/gear/format'

interface Props {
  label: string
  used: number
  interval: number
  metric: TriggerMetric
  kind: TriggerKind
  status: TriggerStatus
}

const BAR: Record<TriggerStatus, string> = {
  ok: 'bg-green-500',
  due_soon: 'bg-amber-500',
  overdue: 'bg-red-500',
}

export default function TriggerProgressBar({ label, used, interval, metric, kind, status }: Props) {
  const pct = interval > 0 ? (used / interval) * 100 : 0
  const width = Math.min(100, Math.max(0, pct))
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium text-slate-800 truncate">{label}</span>
        <span className="text-xs text-slate-500 tabular-nums shrink-0">{fmtNum(used)} / {fmtNum(interval)} {metric}</span>
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(width)}
        className="h-2 rounded-full bg-slate-100 overflow-hidden"
      >
        <div className={`h-full rounded-full ${BAR[status]}`} style={{ width: `${width}%` }} />
      </div>
      <div className="flex gap-2 text-[11px] text-slate-400">
        {kind === 'lifetime' && <span>Lifetime limit</span>}
        {status === 'overdue' && <span className="font-semibold text-red-600">Overdue</span>}
        {status === 'due_soon' && <span className="font-semibold text-amber-600">Due soon</span>}
      </div>
    </div>
  )
}
