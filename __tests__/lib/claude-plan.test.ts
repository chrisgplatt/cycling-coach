import { generatePlan, createPlanStream } from '@/lib/claude/plan'
import type { UserProfile, ICUSyncData, GeneratedPlan } from '@/types'

const mockFinalMessage = jest.fn()
jest.mock('@/lib/claude/client', () => ({
  MODEL: 'claude-sonnet-4-6',
  anthropic: {
    messages: {
      create: jest.fn(),
      stream: jest.fn(() => ({ on: jest.fn(), finalMessage: mockFinalMessage })),
    },
  },
}))

const profile: UserProfile = {
  goals: 'Complete a gran fondo in June',
  events: [{ name: 'Dragon Ride', date: '2026-06-21', type: 'sportive', priority: 'A' }],
  weekly_hours: 8,
  rest_days: ['monday', 'friday'],
  current_ftp: 240,
  weight_kg: 72,
  intervals_icu_athlete_id: 'i12345',
  intervals_icu_api_key: 'key',
}

const syncData: ICUSyncData = {
  activities: [],
  wellness: [],
  athlete_ftp: 240,
  athlete_weight: 72,
}

const validPlan: GeneratedPlan = {
  rationale: 'Base phase focusing on aerobic development.',
  target_event_name: 'Dragon Ride',
  target_event_date: '2026-06-21',
  phase: 'base',
  workouts: [
    {
      date: '2026-05-13',
      type: 'endurance',
      duration_minutes: 90,
      description: 'Easy Zone 2 ride',
      target_zones: 'Zone 2 (55-75% FTP)',
    },
  ],
}

describe('generatePlan', () => {
  it('returns a GeneratedPlan when Claude returns valid JSON', async () => {
    mockFinalMessage.mockResolvedValueOnce({
      content: [{ type: 'text', text: JSON.stringify(validPlan) }],
    })

    const result = await generatePlan(profile, syncData)
    expect(result.rationale).toBe('Base phase focusing on aerobic development.')
    expect(result.workouts).toHaveLength(1)
    expect(result.workouts[0].type).toBe('endurance')
  })

  it('throws if Claude returns malformed JSON', async () => {
    mockFinalMessage.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'not json' }],
    })

    await expect(generatePlan(profile, syncData)).rejects.toThrow('Failed to parse plan')
  })
})

import { formatDossier } from '@/lib/claude/dossier'
import type { AthleteDossier } from '@/lib/claude/dossier'

const mockDossierForPlan: AthleteDossier = {
  id: 'd4',
  user_id: 'u1',
  synthesized_at: new Date().toISOString(),
  content: {
    as_rider: 'Consistent amateur cyclist.',
    strengths: ['Aerobic base'],
    weaknesses: ['Pacing in races'],
    training_compliance: 'Very reliable.',
    recovery_profile: 'Good 48h recovery.',
    event_performance: 'Solid B-race results.',
    trajectory: 'Building toward peak.',
  },
  explicit_notes: [],
  created_at: new Date().toISOString(),
}

describe('createPlanStream — dossier injection', () => {
  it('accepts a 6th dossierSection argument without error', () => {
    const dossierSection = formatDossier(mockDossierForPlan)
    // Just verify createPlanStream accepts the argument — it returns a stream object
    expect(() => {
      createPlanStream(profile, syncData, 4, '2026-06-01', '', dossierSection)
    }).not.toThrow()
  })
})
