/** @jest-environment node */
import { generateBriefing } from '@/lib/claude/briefing'
import type { BriefingContext } from '@/types'

jest.mock('@/lib/claude/client', () => ({
  MODEL: 'claude-sonnet-4-6',
  anthropic: {
    messages: {
      create: jest.fn(),
      stream: jest.fn(),
    },
  },
}))

import { anthropic } from '@/lib/claude/client'
const mockCreate = anthropic.messages.create as jest.Mock

beforeEach(() => mockCreate.mockReset())

const basePostRideCtx: BriefingContext = {
  today: '2026-05-28',
  todayWorkout: {
    id: 'w1', plan_id: 'p1', date: '2026-05-28', type: 'intervals',
    duration_minutes: 60, description: '4x8', target_zones: 'Z4',
    intervals_icu_event_id: null, status: 'completed', icu_activity_id: 'a1',
    tss: 78, missed_reason: null, steps: null, created_at: '',
  },
  todayWorkouts: [],
  todayEvent: null,
  workoutCompleted: true,
  completedRide: null,
  completedRides: null,
  ctl: 65, atl: 70, tsb: -5,
  readinessLabel: 'Moderate',
  hrv: 50,
  recentWorkouts: [],
  upcomingEvents: [],
}

describe('generatePostRideNote — enriched detail', () => {
  it('includes elevation and execution detail in the post-ride prompt', async () => {
    mockCreate.mockResolvedValue({ content: [{ type: 'text', text: 'Solid work.' }] })
    const ctx: BriefingContext = {
      ...basePostRideCtx,
      completedRides: [{
        name: 'Threshold', avg_power: 231, weighted_avg_power: 248, tss: 78,
        moving_time: 3600, elevation_m: 84,
        execution: 'Planned steps: Work 8min @ 95%\nActual intervals: Work 8:00 avg 244W HR 161',
      }],
    }
    await generateBriefing(ctx)
    const prompt = mockCreate.mock.calls[0][0].messages[0].content
    expect(prompt).toContain('84m climb')
    expect(prompt).toContain('Actual intervals:')
  })
})
