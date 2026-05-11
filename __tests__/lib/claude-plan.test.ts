import { generatePlan } from '@/lib/claude/plan'
import type { UserProfile, ICUSyncData, GeneratedPlan } from '@/types'

jest.mock('@/lib/claude/client', () => ({
  MODEL: 'claude-sonnet-4-6',
  anthropic: {
    messages: {
      create: jest.fn(),
    },
  },
}))

import { anthropic } from '@/lib/claude/client'

const mockCreate = anthropic.messages.create as jest.Mock

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
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: JSON.stringify(validPlan) }],
    })

    const result = await generatePlan(profile, syncData)
    expect(result.rationale).toBe('Base phase focusing on aerobic development.')
    expect(result.workouts).toHaveLength(1)
    expect(result.workouts[0].type).toBe('endurance')
  })

  it('throws if Claude returns malformed JSON', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'not json' }],
    })

    await expect(generatePlan(profile, syncData)).rejects.toThrow('Failed to parse plan')
  })
})
