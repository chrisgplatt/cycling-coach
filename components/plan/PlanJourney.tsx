import type { PlanPhase } from '@/types'
import type { WeekState } from '@/lib/plan/progress'

// Phase band styles tuned to read on the blue hero background.
const PHASE_BAND: Record<PlanPhase, string> = {
  base: 'bg-blue-200 text-blue-900',
  build: 'bg-blue-400 text-white',
  peak: 'bg-blue-900 text-white',
  taper: 'bg-amber-400 text-amber-900',
}
const PHASE_LABEL: Record<PlanPhase, string> = { base: 'Base', build: 'Build', peak: 'Peak', taper: 'Taper' }

// Week block fills (on blue): completion read via white opacity, current = yellow ring.
const BLOCK: Record<WeekState, string> = {
  done: 'bg-white',
  partial: 'bg-white/60',
  missed: 'bg-red-300',
  current: 'bg-white ring-2 ring-yellow-300',
  upcoming: 'bg-white/25',
}

interface PlanJourneyProps {
  states: WeekState[]
  phases: PlanPhase[]
  weekLabel: string
  phaseLabel: string
  eventName: string | null
  daysToEvent: number | null
}

export default function PlanJourney({ states, phases, weekLabel, phaseLabel, eventName, daysToEvent }: PlanJourneyProps) {
  // Collapse consecutive same-phase weeks into bands; each band grows by its week-span.
  const bands: { phase: PlanPhase; span: number }[] = []
  for (const p of phases) {
    const last = bands[bands.length - 1]
    if (last && last.phase === p) last.span++
    else bands.push({ phase: p, span: 1 })
  }

  return (
    <div data-testid="plan-journey" className="mt-3">
      <div className="flex gap-0.5 mb-1.5">
        {bands.map((b, i) => (
          <div
            key={i}
            style={{ flexGrow: b.span }}
            className={`h-3.5 flex items-center justify-center rounded-sm text-[8px] font-extrabold tracking-wide ${PHASE_BAND[b.phase]}`}
          >
            {b.span > 1 ? PHASE_LABEL[b.phase].toUpperCase() : PHASE_LABEL[b.phase][0]}
          </div>
        ))}
      </div>
      <div className="flex gap-[3px]">
        {states.map((s, i) => (
          <div key={i} data-week-block data-state={s} className={`flex-1 h-6 rounded ${BLOCK[s]}`} />
        ))}
      </div>
      <p className="mt-2 text-[11px] opacity-90">
        {weekLabel} · {phaseLabel}
        {eventName && daysToEvent != null && (
          <> · 🏁 {daysToEvent} day{daysToEvent !== 1 ? 's' : ''} to {eventName}</>
        )}
      </p>
    </div>
  )
}
