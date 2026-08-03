import { generatePlan, createPlanStream, countPlannedWorkouts, parsePlanText, estimateTss } from '@/lib/claude/plan'
import type { UserProfile, ICUSyncData, GeneratedPlan } from '@/types'
import { makeGeneratedWorkout } from '../support/factories'

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
    makeGeneratedWorkout({
      date: '2026-05-13',
      type: 'endurance',
      duration_minutes: 90,
      description: 'Easy Zone 2 ride',
      target_zones: 'Zone 2 (55-75% FTP)',
    }),
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

  it('throws if Claude returns valid JSON with no workouts', async () => {
    mockFinalMessage.mockResolvedValueOnce({
      content: [{ type: 'text', text: JSON.stringify({ ...validPlan, workouts: [] }) }],
    })

    await expect(generatePlan(profile, syncData)).rejects.toThrow('Failed to parse plan')
  })
})

describe('parsePlanText', () => {
  it('throws a specific, actionable error when the parsed plan has no workouts', () => {
    expect(() => parsePlanText(JSON.stringify({ ...validPlan, workouts: [] }))).toThrow(
      'The coach generated a plan with no workouts — please try again.'
    )
  })

  it('throws when the plan omits the workouts field entirely', () => {
    const { workouts: _workouts, ...withoutWorkouts } = validPlan
    expect(() => parsePlanText(JSON.stringify(withoutWorkouts))).toThrow(
      'The coach generated a plan with no workouts — please try again.'
    )
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

import { anthropic } from '@/lib/claude/client'

describe('createPlanStream — batching', () => {
  it('passes an explicit capped thinking budget', () => {
    createPlanStream(profile, syncData, 12, '2026-06-01')
    const call = (anthropic.messages.stream as jest.Mock).mock.calls.at(-1)[0]
    expect(call.thinking).toEqual({ type: 'enabled', budget_tokens: 4000 })
  })

  it('defaults to a single full-plan batch when no batch info is given', () => {
    createPlanStream(profile, syncData, 12, '2026-06-01')
    const prompt = (anthropic.messages.stream as jest.Mock).mock.calls.at(-1)[0].messages[0].content as string
    expect(prompt).toContain('Generate all 12 weeks now.')
    expect(prompt).not.toContain('PLAN SO FAR')
    expect(prompt).toContain('"rationale"')
  })

  it('scopes a middle batch to its own week range and flags the plan continues', () => {
    createPlanStream(profile, syncData, 12, '2026-06-01', '', '', null, null, {
      batchStartWeek: 4, batchWeekCount: 4, priorWorkouts: [],
    })
    const prompt = (anthropic.messages.stream as jest.Mock).mock.calls.at(-1)[0].messages[0].content as string
    expect(prompt).toContain('Generate only weeks 5-8 now')
    expect(prompt).toContain('do not taper or wind the training down')
  })

  it('flags the final batch as the end of the plan (no continuation warning)', () => {
    createPlanStream(profile, syncData, 12, '2026-06-01', '', '', null, null, {
      batchStartWeek: 8, batchWeekCount: 4, priorWorkouts: [],
    })
    const prompt = (anthropic.messages.stream as jest.Mock).mock.calls.at(-1)[0].messages[0].content as string
    expect(prompt).toContain('Generate only weeks 9-12 now')
    expect(prompt).not.toContain('do not taper or wind the training down')
  })

  it('includes a PLAN SO FAR summary of prior workouts for a later batch', () => {
    const priorWorkouts = [
      {
        date: '2026-06-01', type: 'endurance' as const, duration_minutes: 60, description: 'd', target_zones: 'z',
        steps: [{ label: 'Main', duration_minutes: 60, power_pct_ftp: 70 }],
      },
    ]
    createPlanStream(profile, syncData, 12, '2026-06-01', '', '', null, null, {
      batchStartWeek: 4, batchWeekCount: 4, priorWorkouts,
    })
    const prompt = (anthropic.messages.stream as jest.Mock).mock.calls.at(-1)[0].messages[0].content as string
    expect(prompt).toContain('PLAN SO FAR')
    expect(prompt).toContain('Week 1: 1 session')
  })

  it('lists the fixed phase for each week in the batch', () => {
    createPlanStream(profile, syncData, 12, '2026-06-01', '', '', null, null, {
      batchStartWeek: 4, batchWeekCount: 4, priorWorkouts: [],
    })
    const prompt = (anthropic.messages.stream as jest.Mock).mock.calls.at(-1)[0].messages[0].content as string
    // computeWeekPhases(12) = 4x base, 5x build, 1x peak, 2x taper -> week 5 (index 4) is the first build week
    expect(prompt).toContain('Week 5: build')
  })

  it('omits rationale/target_event fields from the requested schema for a non-first batch', () => {
    createPlanStream(profile, syncData, 12, '2026-06-01', '', '', null, null, {
      batchStartWeek: 4, batchWeekCount: 4, priorWorkouts: [],
    })
    const prompt = (anthropic.messages.stream as jest.Mock).mock.calls.at(-1)[0].messages[0].content as string
    expect(prompt).not.toContain('"rationale"')
  })

  it('requires the final workout to land within the last 7 days of the batch window', () => {
    createPlanStream(profile, syncData, 12, '2026-06-01', '', '', null, null, {
      batchStartWeek: 4, batchWeekCount: 4, priorWorkouts: [],
    })
    const prompt = (anthropic.messages.stream as jest.Mock).mock.calls.at(-1)[0].messages[0].content as string
    expect(prompt).toContain('do not stop short')
  })
})

describe('estimateTss', () => {
  it('estimates TSS from a single full-power-hour step as 100', () => {
    expect(estimateTss([{ duration_minutes: 60, power_pct_ftp: 100 }])).toBe(100)
  })

  it('sums TSS across multiple steps', () => {
    const steps = [
      { duration_minutes: 15, power_pct_ftp: 60 },
      { duration_minutes: 30, power_pct_ftp: 90 },
      { duration_minutes: 15, power_pct_ftp: 55 },
    ]
    expect(estimateTss(steps)).toBeGreaterThan(0)
  })
})

describe('generatePlan — multi-day and continue-training holiday events', () => {
  it('shows the full date range and BLOCKED status for a default multi-day holiday', async () => {
    mockFinalMessage.mockResolvedValueOnce({
      content: [{ type: 'text', text: JSON.stringify(validPlan) }],
    })
    const profileWithHoliday = {
      ...profile,
      events: [
        ...profile.events,
        { name: 'Ski Trip', date: '2026-08-10', end_date: '2026-08-17', type: 'holiday' as const, priority: 'C' as const },
      ],
    }
    await generatePlan(profileWithHoliday, syncData)
    const sentPrompt = (require('@/lib/claude/client').anthropic.messages.stream as jest.Mock).mock.calls.at(-1)[0].messages[0].content as string
    expect(sentPrompt).toContain('2026-08-10 to 2026-08-17 BLOCKED: Ski Trip')
  })

  it('marks a continue-training holiday as not blocked and instructs sparse optional sessions', async () => {
    mockFinalMessage.mockResolvedValueOnce({
      content: [{ type: 'text', text: JSON.stringify(validPlan) }],
    })
    const profileWithHoliday = {
      ...profile,
      events: [
        ...profile.events,
        {
          name: 'Ski Trip', date: '2026-08-10', end_date: '2026-08-17',
          type: 'holiday' as const, priority: 'C' as const, continue_training: true,
        },
      ],
    }
    await generatePlan(profileWithHoliday, syncData)
    const sentPrompt = (require('@/lib/claude/client').anthropic.messages.stream as jest.Mock).mock.calls.at(-1)[0].messages[0].content as string
    expect(sentPrompt).toContain('2026-08-10 to 2026-08-17 NOT BLOCKED')
    expect(sentPrompt).toContain('roughly 2 optional quality sessions per 7 days')
    expect(sentPrompt).not.toContain('2026-08-10 to 2026-08-17 BLOCKED: Ski Trip')
  })
})

describe('countPlannedWorkouts — multi-day and continue-training holidays', () => {
  it('excludes every day of a multi-day blocked event from the count', () => {
    const profileWithHoliday: UserProfile = {
      ...profile,
      weekly_availability: [
        { day: 'monday', duration_minutes: 60 }, { day: 'tuesday', duration_minutes: 60 },
        { day: 'wednesday', duration_minutes: 60 }, { day: 'thursday', duration_minutes: 60 },
        { day: 'friday', duration_minutes: 60 }, { day: 'saturday', duration_minutes: 90 }, { day: 'sunday', duration_minutes: 90 },
      ],
      events: [{ name: 'Ski Trip', date: '2026-06-01', end_date: '2026-06-07', type: 'holiday', priority: 'C' }],
    }
    // 2026-06-01 is a Monday — a full 7-day week, all 7 days blocked by the holiday.
    expect(countPlannedWorkouts(profileWithHoliday, 1, '2026-06-01')).toBe(0)
  })

  it('excludes a continue-training holiday from the count the same way (sparse sessions are not deterministic)', () => {
    const profileWithHoliday: UserProfile = {
      ...profile,
      weekly_availability: [
        { day: 'monday', duration_minutes: 60 }, { day: 'tuesday', duration_minutes: 60 },
        { day: 'wednesday', duration_minutes: 60 }, { day: 'thursday', duration_minutes: 60 },
        { day: 'friday', duration_minutes: 60 }, { day: 'saturday', duration_minutes: 90 }, { day: 'sunday', duration_minutes: 90 },
      ],
      events: [{ name: 'Ski Trip', date: '2026-06-01', end_date: '2026-06-07', type: 'holiday', priority: 'C', continue_training: true }],
    }
    expect(countPlannedWorkouts(profileWithHoliday, 1, '2026-06-01')).toBe(0)
  })
})

describe('summariseWellness (via generatePlan prompt)', () => {
  it('includes Max HR in the prompt when resolvable from date of birth', async () => {
    mockFinalMessage.mockResolvedValueOnce({
      content: [{ type: 'text', text: JSON.stringify(validPlan) }],
    })
    const profileWithDob = { ...profile, date_of_birth: '1990-07-03' }
    await generatePlan(profileWithDob, syncData)
    const sentPrompt = (anthropic.messages.stream as jest.Mock).mock.calls.at(-1)[0].messages[0].content as string
    expect(sentPrompt).toContain('Max HR: 183bpm')
  })

  it('omits Max HR when it cannot be resolved', async () => {
    mockFinalMessage.mockResolvedValueOnce({
      content: [{ type: 'text', text: JSON.stringify(validPlan) }],
    })
    await generatePlan(profile, syncData)
    const sentPrompt = (anthropic.messages.stream as jest.Mock).mock.calls.at(-1)[0].messages[0].content as string
    expect(sentPrompt).not.toContain('Max HR')
  })
})
