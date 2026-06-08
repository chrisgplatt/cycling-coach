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

describe('buildSessionSystemPrompt — distribution injection', () => {
  it('includes the session distribution summary when the completed workout has one', () => {
    const workout = {
      id: 'w1', date: '2026-06-07', type: 'threshold', duration_minutes: 60,
      description: '2x20 threshold', steps: null, status: 'completed', target_zones: 'Z4',
      activity_metrics: {
        np: 240, avg_power: 230, max_power: 600, avg_hr: 150, distance_m: 30000,
        elevation_m: 200, lr_balance: 50, best_efforts: null, intervals: null,
        decoupling_pct: null, climbs: null, time_in_zone: null, shape: null,
        synced_at: '2026-06-07T10:00:00Z',
        distributions: {
          power: [{ edge: 100, secs: 1200 }], power_vi: 1.04, power_steady_pct: 61,
          cadence: null, coasting_secs: null, hr: null, hr_lthr: null,
        },
      },
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const prompt = buildSessionSystemPrompt(workout as any, null, [], null, 250, [])
    expect(prompt).toContain('Power shape: VI 1.04')
  })
})
