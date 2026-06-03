import type { CoachingLogEntry } from '@/types'

interface CoachingLogProps {
  entries: CoachingLogEntry[]
}

const CARD = 'bg-white rounded-xl border border-slate-100 shadow-sm p-4'
const HEADING = 'text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-3'

function statusChip(e: CoachingLogEntry): { label: string; cls: string } {
  if (!e.had_proposal) return { label: '• logged', cls: 'text-slate-400' }
  if (e.approved === true) return { label: '✓ applied', cls: 'text-emerald-600' }
  if (e.approved === false) return { label: '✗ dismissed', cls: 'text-slate-400' }
  return { label: '… pending', cls: 'text-amber-600' }
}

function header(e: CoachingLogEntry): string {
  if (!e.session_date) return 'Manual note'
  const [y, m, d] = e.session_date.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short',
  })
  const type = e.session_type
    ? e.session_type.charAt(0).toUpperCase() + e.session_type.slice(1)
    : ''
  return type ? `${date} · ${type}` : date
}

export default function CoachingLog({ entries }: CoachingLogProps) {
  return (
    <div data-testid="coaching-log" className={CARD}>
      <p className={HEADING}>Coaching log</p>
      {entries.length === 0 ? (
        <p className="text-sm text-slate-400">
          No feedback logged yet — add notes after a session and your coach&apos;s adjustments show up here.
        </p>
      ) : (
        <ul className="space-y-3">
          {entries.map(e => {
            const chip = statusChip(e)
            return (
              <li key={e.id} className="border-b border-slate-100 last:border-0 pb-3 last:pb-0">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-xs font-semibold text-slate-600">{header(e)}</p>
                  <span className={`text-[11px] font-medium shrink-0 ${chip.cls}`}>{chip.label}</span>
                </div>
                <p className="text-sm text-slate-700 mt-1 line-clamp-2">{e.feedback_text}</p>
                {e.summary && (
                  <p className="text-xs text-slate-500 mt-1">→ {e.summary}</p>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
