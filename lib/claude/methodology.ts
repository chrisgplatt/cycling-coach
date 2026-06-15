import type { TrainingPhilosophy } from '@/types'

export interface MethodologyInput {
  weeklyHours: number
  weeksToEvent: number
  eventType: string
  eventPriority: string
  currentCTL: number | null
  goals: string
}

const PHASE_MATRIX: Record<number, TrainingPhilosophy['phase_weeks']> = {
  4:  { base: 1, build: 2, peak: 0, taper: 1 },
  6:  { base: 2, build: 2, peak: 1, taper: 1 },
  8:  { base: 2, build: 3, peak: 1, taper: 2 },
  10: { base: 3, build: 4, peak: 1, taper: 2 },
  12: { base: 4, build: 5, peak: 1, taper: 2 },
  16: { base: 6, build: 6, peak: 2, taper: 2 },
  20: { base: 8, build: 7, peak: 2, taper: 3 },
}

function getPhaseWeeks(totalWeeks: number): TrainingPhilosophy['phase_weeks'] {
  const keys = Object.keys(PHASE_MATRIX).map(Number).sort((a, b) => a - b)
  const nearest = keys.reduce((prev, cur) =>
    Math.abs(cur - totalWeeks) <= Math.abs(prev - totalWeeks) ? cur : prev
  )
  return PHASE_MATRIX[nearest]
}

function approachLabel(profile: TrainingPhilosophy['intensity_profile']): string {
  if (profile === 'threshold-heavy') return 'threshold-focused base'
  if (profile === 'simplified') return 'simplified base'
  return 'polarised base'
}

export function computeMethodology(input: MethodologyInput): TrainingPhilosophy {
  const clampedWeeks = Math.max(4, input.weeksToEvent)  // minimum 4-week plan
  const phaseWeeks = getPhaseWeeks(clampedWeeks)
  const intensityProfile: TrainingPhilosophy['intensity_profile'] =
    input.weeklyHours >= 8 ? 'polarised-base' : 'threshold-heavy'

  const approach = approachLabel(intensityProfile)
  const label = `Friel periodization · ${approach}`
  const name = `friel-${intensityProfile}`

  const { base, build, peak, taper } = phaseWeeks
  const phaseParts = [
    base > 0 ? `${base}wk base` : null,
    build > 0 ? `${build}wk build` : null,
    peak > 0 ? `${peak}wk peak` : null,
    taper > 0 ? `${taper}wk taper` : null,
  ].filter(Boolean).join(', ')

  const rationale = `Based on your ${input.weeklyHours.toFixed(1)}h/week schedule and a ${input.eventType} in ${clampedWeeks} weeks, I recommend Friel periodization with a ${approach}: ${phaseParts}.`

  return {
    name,
    label,
    phase_weeks: phaseWeeks,
    intensity_profile: intensityProfile,
    weekly_hours_at_creation: input.weeklyHours,
    rationale,
  }
}
