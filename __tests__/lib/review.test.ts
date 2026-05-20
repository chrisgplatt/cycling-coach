jest.mock('@/lib/claude/client', () => ({
  MODEL: 'claude-opus-4-7',
  anthropic: { messages: { stream: jest.fn() } },
}))

import { buildReviewPrompt } from '@/lib/claude/review'
import type { UserProfile, Workout, ICUWellness } from '@/types'

const profile: UserProfile = {
  goals: 'Build base fitness',
  events: [],
  weekly_availability: [{ day: 'Tuesday', duration_minutes: 90 }],
  current_ftp: 250,
  weight_kg: 70,
  intervals_icu_athlete_id: 'i123',
  intervals_icu_api_key: 'key',
}

function makeWorkout(overrides: Partial<Workout>): Workout {
  return {
    id: 'w1', plan_id: 'p1', date: '2026-05-12',
    type: 'endurance', duration_minutes: 90,
    description: 'Zone 2 ride', target_zones: 'Zone 2',
    intervals_icu_event_id: null, status: 'planned',
    icu_activity_id: null, tss: null, missed_reason: null,
    created_at: '',
    ...overrides,
  }
}

describe('buildReviewPrompt — formatLastWeekWorkouts', () => {
  it('includes reason for skipped workouts when missed_reason is set', () => {
    const skipped = makeWorkout({ status: 'skipped', missed_reason: 'Illness' })
    const prompt = buildReviewPrompt(profile, [skipped], [], [], '')
    expect(prompt).toContain('status: skipped (Illness)')
  })

  it('omits reason parenthetical when missed_reason is null', () => {
    const skipped = makeWorkout({ status: 'skipped', missed_reason: null })
    const prompt = buildReviewPrompt(profile, [skipped], [], [], '')
    expect(prompt).toContain('status: skipped')
    expect(prompt).not.toContain('skipped (')
  })

  it('does not add parenthetical for completed workouts even if missed_reason is set', () => {
    const completed = makeWorkout({ status: 'completed', missed_reason: 'Weather' })
    const prompt = buildReviewPrompt(profile, [completed], [], [], '')
    expect(prompt).toContain('status: completed')
    expect(prompt).not.toContain('completed (')
  })
})
