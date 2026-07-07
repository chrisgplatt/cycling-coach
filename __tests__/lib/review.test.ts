jest.mock('@/lib/claude/client', () => ({
  MODEL: 'claude-opus-4-7',
  anthropic: { messages: { stream: jest.fn() } },
}))

import { buildReviewPrompt } from '@/lib/claude/review'
import type { UserProfile, Workout, ICUWellness } from '@/types'
import { makeWorkout as baseWorkout } from '../support/factories'

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
  return baseWorkout({
    date: '2026-05-12', duration_minutes: 90,
    description: 'Zone 2 ride', target_zones: 'Zone 2',
    ...overrides,
  })
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
    // The status field must carry no parenthetical for completed workouts.
    // (The unrelated "actual: completed (no activity data)" string is expected.)
    expect(prompt).not.toContain('status: completed (')
  })
})

import { formatDossier } from '@/lib/claude/dossier'
import type { AthleteDossier } from '@/lib/claude/dossier'

const mockDossierForReview: AthleteDossier = {
  id: 'd5',
  user_id: 'u1',
  synthesized_at: new Date().toISOString(),
  content: {
    as_rider: 'Dedicated cyclist with strong Z2 base.',
    strengths: ['Endurance', 'Recovery'],
    weaknesses: ['High-intensity efforts'],
    training_compliance: 'Consistently completes all sessions.',
    recovery_profile: 'Bounces back quickly.',
    event_performance: 'Strong sportive results.',
    trajectory: 'Peak fitness approaching.',
  },
  explicit_notes: [],
  created_at: new Date().toISOString(),
}

describe('buildReviewPrompt — dossier injection', () => {
  it('includes dossier notes when dossierSection provided', () => {
    const dossierSection = formatDossier(mockDossierForReview)
    const prompt = buildReviewPrompt(
      profile,
      [],
      [],
      [],
      '',
      [],
      dossierSection,
    )
    expect(prompt).toContain("COACH'S NOTES ON THIS ATHLETE")
    expect(prompt).toContain('Dedicated cyclist')
  })
})

describe('buildReviewPrompt Max HR', () => {
  it('includes Max HR when resolvable', () => {
    const profileWithDob = { ...profile, date_of_birth: '1990-07-03' }
    const prompt = buildReviewPrompt(profileWithDob, [], [], [], '')
    expect(prompt).toContain('Max HR: 183bpm')
  })

  it('omits Max HR when it cannot be resolved', () => {
    const prompt = buildReviewPrompt(profile, [], [], [], '')
    expect(prompt).not.toContain('Max HR')
  })
})

describe('buildReviewPrompt — workout type options', () => {
  it('offers test as a valid workout type alongside guidance on when to use it', () => {
    const prompt = buildReviewPrompt(profile, [], [], [], '')
    expect(prompt).toContain('"endurance|threshold|intervals|recovery|test"')
    expect(prompt).toContain('Use type: test for FTP tests, ramp tests, and any fitness assessment sessions')
  })
})
