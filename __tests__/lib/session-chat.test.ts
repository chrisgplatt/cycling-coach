import { buildSessionSystemPrompt } from '@/lib/claude/session-chat'
import { formatDossier } from '@/lib/claude/dossier'
import type { AthleteDossier } from '@/lib/claude/dossier'
import type { Workout, TrainingPlan, ICUWellness } from '@/types'
import { makeWorkout, makeTrainingPlan } from '../support/factories'

const workout = makeWorkout({
  id: 'wk-today',
  date: '2026-05-24',
  type: 'threshold',
  description: '2x20min at threshold',
  target_zones: 'Zone 4 (91-105% FTP)',
})

const plan = makeTrainingPlan({
  name: 'Gran Fondo Build',
  target_event_name: 'Etape du Tour',
  target_event_date: '2026-07-10',
  rationale: 'Progressive build towards A event',
})

const upcoming = [
  makeWorkout({ id: 'wk-thu', date: '2026-05-27', type: 'endurance', duration_minutes: 90,
    description: 'Zone 2 ride' }),
]

const wellness: ICUWellness = {
  id: '2026-05-24', ctl: 65, atl: 72, form: -7, hrv: 52, resting_hr: 48, sleep_secs: null,
}

describe('buildSessionSystemPrompt', () => {
  it('includes today workout ID and type', () => {
    const prompt = buildSessionSystemPrompt(workout, plan, upcoming, wellness, 240)
    expect(prompt).toContain('wk-today')
    expect(prompt).toContain('threshold')
    expect(prompt).toContain('60 min')
  })

  it('includes fitness metrics', () => {
    const prompt = buildSessionSystemPrompt(workout, plan, upcoming, wellness, 240)
    expect(prompt).toContain('65')   // CTL
    expect(prompt).toContain('-7')   // form
    expect(prompt).toContain('240W') // FTP
  })

  it('includes upcoming workout IDs for week proposals', () => {
    const prompt = buildSessionSystemPrompt(workout, plan, upcoming, wellness, 240)
    expect(prompt).toContain('wk-thu')
  })

  it('includes __PROPOSAL__ instruction', () => {
    const prompt = buildSessionSystemPrompt(workout, plan, upcoming, wellness, 240)
    expect(prompt).toContain('__PROPOSAL__')
  })

  it('includes __WEEK_PROPOSAL__ instruction', () => {
    const prompt = buildSessionSystemPrompt(workout, plan, upcoming, wellness, 240)
    expect(prompt).toContain('__WEEK_PROPOSAL__')
  })

  it('handles null wellness gracefully', () => {
    expect(() => buildSessionSystemPrompt(workout, null, [], null, 200)).not.toThrow()
  })

  it('includes __REMEMBER__ instruction', () => {
    const prompt = buildSessionSystemPrompt(workout, plan, upcoming, wellness, 240)
    expect(prompt).toContain('__REMEMBER__')
  })

  it('includes __FORGET__ instruction', () => {
    const prompt = buildSessionSystemPrompt(workout, plan, upcoming, wellness, 240)
    expect(prompt).toContain('__FORGET__')
  })
})

const mockDossierForSession: AthleteDossier = {
  id: 'd1',
  user_id: 'u1',
  synthesized_at: new Date().toISOString(),
  content: {
    as_rider: 'Strong climber with good aerobic base.',
    strengths: ['Z2 compliance'],
    weaknesses: ['Pacing'],
    training_compliance: 'Consistent.',
    recovery_profile: 'Recovers fast.',
    event_performance: 'Solid sportive results.',
    trajectory: 'Improving.',
  },
  explicit_notes: [],
  created_at: new Date().toISOString(),
}

describe('buildSessionSystemPrompt — dossier injection', () => {
  it('includes dossier section when provided', () => {
    const dossierSection = formatDossier(mockDossierForSession)
    const prompt = buildSessionSystemPrompt(workout, plan, upcoming, wellness, 240, [], dossierSection)
    expect(prompt).toContain("COACH'S NOTES ON THIS ATHLETE")
    expect(prompt).toContain('Strong climber')
  })

  it('omits dossier section when empty string', () => {
    const prompt = buildSessionSystemPrompt(workout, plan, upcoming, wellness, 240, [], '')
    expect(prompt).not.toContain("COACH'S NOTES ON THIS ATHLETE")
  })
})
