import { buildSessionSystemPrompt } from '@/lib/claude/session-chat'
import type { Workout, TrainingPlan, ICUWellness } from '@/types'

const workout: Workout = {
  id: 'wk-today',
  plan_id: 'plan1',
  date: '2026-05-24',
  type: 'threshold',
  duration_minutes: 60,
  description: '2x20min at threshold',
  target_zones: 'Zone 4 (91-105% FTP)',
  intervals_icu_event_id: null,
  status: 'planned',
  icu_activity_id: null,
  tss: null,
  missed_reason: null,
  steps: null,
  created_at: '',
}

const plan: TrainingPlan = {
  id: 'plan1',
  name: 'Gran Fondo Build',
  status: 'active',
  target_event_name: 'Etape du Tour',
  target_event_date: '2026-07-10',
  phase: 'build',
  rationale: 'Progressive build towards A event',
  last_reviewed_week: null,
  created_at: '',
  updated_at: '',
}

const upcoming: Workout[] = [
  { ...workout, id: 'wk-thu', date: '2026-05-27', type: 'endurance', duration_minutes: 90,
    description: 'Zone 2 ride', status: 'planned' },
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
})
