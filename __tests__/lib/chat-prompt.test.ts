/** @jest-environment node */
import { buildChatSystemPrompt } from '@/lib/claude/chat'
import { formatDossier } from '@/lib/claude/dossier'
import type { AthleteDossier } from '@/lib/claude/dossier'
import type { TrainingPlan, Workout, ICUWellness, TrainingEvent } from '@/types'

const plan: TrainingPlan = {
  id: 'p1', name: 'Build', status: 'active',
  target_event_name: 'Etape', target_event_date: '2026-07-10',
  phase: 'build', rationale: 'Progressive build', last_reviewed_week: null,
  plan_weeks: 6, created_at: '', updated_at: '',
}

const upcoming: Workout[] = [{
  id: 'wk1', plan_id: 'p1', date: '2026-06-02', type: 'endurance',
  duration_minutes: 90, description: 'Zone 2 ride', target_zones: 'Z2',
  intervals_icu_event_id: null, status: 'planned', icu_activity_id: null,
  tss: null, missed_reason: null, steps: null, created_at: '',
}]

const wellness: ICUWellness = {
  id: '2026-05-30', ctl: 65, atl: 70, form: -5, hrv: 50, resting_hr: 48, sleep_secs: null,
}

const events: TrainingEvent[] = [
  { name: 'Etape', date: '2026-07-10', type: 'sportive', priority: 'A' },
]

const recentRides = [{
  id: 'r1', date: '2026-05-28', type: 'intervals', duration_minutes: 60,
  steps: [
    { label: 'Warm Up', duration_minutes: 10, power_pct_ftp: 60 },
    { label: 'Work', duration_minutes: 8, power_pct_ftp: 95 },
  ],
  activity_metrics: {
    np: 248, avg_power: 231, max_power: 612, avg_hr: 152, distance_m: 32500,
    elevation_m: 84, lr_balance: 51, best_efforts: [{ secs: 1200, watts: 264 }],
    intervals: [{ label: 'Work', duration_secs: 480, avg_watts: 244, avg_hr: 161 }],
    synced_at: '2026-05-28T09:00:00Z',
  },
}]

const dossier: AthleteDossier = {
  id: 'd1', user_id: 'u1', synthesized_at: new Date().toISOString(),
  content: {
    as_rider: 'Strong all-rounder.', strengths: ['Z2 compliance'], weaknesses: ['Pacing'],
    training_compliance: 'Consistent.', recovery_profile: 'Recovers fast.',
    event_performance: 'Good sportives.', trajectory: 'Improving.',
  },
  explicit_notes: [], created_at: new Date().toISOString(),
}

describe('buildChatSystemPrompt', () => {
  it('includes FTP and remember/forget markers', () => {
    const p = buildChatSystemPrompt(plan, upcoming, wellness, 240, events)
    expect(p).toContain('240W')
    expect(p).toContain('__REMEMBER__')
    expect(p).toContain('__FORGET__')
  })

  it('includes power zone watt ranges computed from FTP', () => {
    const p = buildChatSystemPrompt(plan, upcoming, wellness, 240, events)
    expect(p).toContain('Power zones')
    expect(p).toContain('Threshold (Z4): 218–252W')
    expect(p).toContain('Endurance (Z2): 134–180W')
  })

  it('instructs the coach to capture notes proactively', () => {
    const p = buildChatSystemPrompt(plan, upcoming, wellness, 240, events)
    expect(p).toContain('even if the athlete did not explicitly ask')
  })

  it('includes capture guardrails against trivia and duplicates', () => {
    const p = buildChatSystemPrompt(plan, upcoming, wellness, 240, events)
    expect(p).toContain('Do not save trivia')
    expect(p).toContain('Never save a note that duplicates')
  })

  it('includes the dossier section when provided and omits it when empty', () => {
    const withD = buildChatSystemPrompt(plan, upcoming, wellness, 240, events, formatDossier(dossier))
    expect(withD).toContain("COACH'S NOTES ON THIS ATHLETE")
    const without = buildChatSystemPrompt(plan, upcoming, wellness, 240, events, '')
    expect(without).not.toContain("COACH'S NOTES ON THIS ATHLETE")
  })

  it('handles a null plan and null wellness without throwing', () => {
    expect(() => buildChatSystemPrompt(null, [], null, 200, [])).not.toThrow()
  })

  it('includes a recent rides block with metrics and execution', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = buildChatSystemPrompt(plan, upcoming, wellness, 240, events, '', recentRides as any)
    expect(p).toContain('Recent rides')
    expect(p).toContain('NP 248W')
    expect(p).toContain('Actual intervals:')
    expect(p).toContain('Work 8:00 avg 244W HR 161')
  })
})
