import type { ReadinessVerdict } from '@/lib/claude/briefing'

interface ReadinessBadgeProps {
  verdict: ReadinessVerdict
  headline: string
}

const STYLE: Record<ReadinessVerdict, { wrap: string; dot: string; word: string }> = {
  green: { wrap: 'bg-emerald-50 border-emerald-200 text-emerald-700', dot: 'bg-emerald-500', word: 'GREEN' },
  amber: { wrap: 'bg-amber-50 border-amber-200 text-amber-700', dot: 'bg-amber-500', word: 'AMBER' },
  red: { wrap: 'bg-red-50 border-red-200 text-red-700', dot: 'bg-red-500', word: 'RED' },
}

export default function ReadinessBadge({ verdict, headline }: ReadinessBadgeProps) {
  const s = STYLE[verdict]
  return (
    <div
      data-testid="readiness-badge"
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold ${s.wrap}`}
    >
      <span className={`w-2 h-2 rounded-full ${s.dot}`} aria-hidden="true" />
      <span>{s.word} · {headline.toUpperCase()}</span>
    </div>
  )
}
