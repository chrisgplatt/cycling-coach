/** @jest-environment node */
import { generateBriefing } from '@/lib/claude/briefing'
import type { BriefingContext } from '@/types'
import { makeWorkout } from '../support/factories'

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
  todayWorkout: makeWorkout({
    id: 'w1', date: '2026-05-28', type: 'intervals',
    duration_minutes: 60, description: '4x8', target_zones: 'Z4',
    status: 'completed', icu_activity_id: 'a1', tss: 78,
  }),
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

const baseMorningCtx: BriefingContext = {
  today: '2026-05-28',
  todayWorkout: {
    id: 'w2', plan_id: 'p1', date: '2026-05-28', type: 'endurance',
    duration_minutes: 90, description: 'Z2 aerobic base', target_zones: 'Z2',
    intervals_icu_event_id: null, status: 'planned', icu_activity_id: null,
    tss: 65, missed_reason: null, steps: null, created_at: '',
    activity_metrics: null, coaching_notes: null,
  },
  todayWorkouts: [],
  todayEvent: null,
  workoutCompleted: false,
  completedRide: null,
  completedRides: null,
  ctl: 65, atl: 70, tsb: -5,
  readinessLabel: 'Moderate',
  hrv: 41,
  recentWorkouts: [],
  upcomingEvents: [],
}

describe('generateMorningBriefing — HRV awareness', () => {
  it('includes SUPPRESSED label in the prompt when hrvStatus is suppressed', async () => {
    mockCreate.mockResolvedValue({ content: [{ type: 'text', text: 'Easy day recommended.' }] })
    const ctx: BriefingContext = {
      ...baseMorningCtx,
      hrvStatus: {
        label: 'suppressed',
        sufficient: true,
        daysOfData: 60,
        today: 41,
        sevenDayAvg: 44,
        baselineMean: 51,
        lowerBound: 47,
        upperBound: 55,
        trend: 'falling',
        baselineDrift: 'falling',
      },
    }
    await generateBriefing(ctx)
    const prompt = mockCreate.mock.calls[0][0].messages[0].content as string
    expect(prompt).toMatch(/SUPPRESSED/)
  })
})

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

describe('generateMorningBriefing — structured verdict', () => {
  it('parses verdict, headline and note from a JSON response', async () => {
    mockCreate.mockResolvedValue({ content: [{ type: 'text', text:
      '{"verdict":"green","headline":"Go hard","note":"HRV balanced — hit the intervals."}' }] })
    const result = await generateBriefing(baseMorningCtx)
    expect(result).toEqual({
      coach_note: 'HRV balanced — hit the intervals.',
      verdict: 'green',
      headline: 'Go hard',
    })
  })

  it('falls back to a null verdict when the response is not JSON', async () => {
    mockCreate.mockResolvedValue({ content: [{ type: 'text', text: 'Just ride easy today.' }] })
    const result = await generateBriefing(baseMorningCtx)
    expect(result.verdict).toBeNull()
    expect(result.headline).toBeNull()
    expect(result.coach_note).toBe('Just ride easy today.')
  })

  it('ignores an invalid verdict value', async () => {
    mockCreate.mockResolvedValue({ content: [{ type: 'text', text:
      '{"verdict":"blue","headline":"x","note":"hello"}' }] })
    const result = await generateBriefing(baseMorningCtx)
    expect(result.verdict).toBeNull()
    expect(result.coach_note).toBe('hello')
  })

  it('parses JSON wrapped in a ```json code fence (with trailing newline)', async () => {
    mockCreate.mockResolvedValue({ content: [{ type: 'text', text:
      '```json\n{"verdict":"amber","headline":"Judge by feel","note":"Mixed signals today."}\n```\n' }] })
    const result = await generateBriefing(baseMorningCtx)
    expect(result.verdict).toBe('amber')
    expect(result.headline).toBe('Judge by feel')
    expect(result.coach_note).toBe('Mixed signals today.')
  })
})

describe('post-ride / post-race verdict', () => {
  it('returns a null verdict for the post-ride path', async () => {
    mockCreate.mockResolvedValue({ content: [{ type: 'text', text: 'Solid work.' }] })
    const result = await generateBriefing(basePostRideCtx)
    expect(result.coach_note).toBe('Solid work.')
    expect(result.verdict).toBeNull()
    expect(result.headline).toBeNull()
  })
})
