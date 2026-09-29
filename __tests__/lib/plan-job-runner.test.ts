/** @jest-environment node */
const mockInterpretGoals = jest.fn()
jest.mock('@/lib/claude/plan-emphasis', () => ({ interpretGoals: (...args: unknown[]) => mockInterpretGoals(...args) }))

const mockFillSession = jest.fn()
const mockFallbackSession = jest.fn()
jest.mock('@/lib/claude/session-fill', () => ({
  fillSession: (...args: unknown[]) => mockFillSession(...args),
  fallbackSession: (...args: unknown[]) => mockFallbackSession(...args),
}))

const mockSendPush = jest.fn()
jest.mock('@/lib/push', () => ({ sendPush: (...args: unknown[]) => mockSendPush(...args) }))

import { runGeneratePlanJob, runPlanJob } from '@/lib/plan/job-runner'
import type { GeneratePlanJobRequest } from '@/lib/plan/job-runner'
import type { UserProfile } from '@/types'

function makeSupabase() {
  const updates: Array<Record<string, unknown>> = []
  return {
    updates,
    from: () => ({
      update: (fields: Record<string, unknown>) => ({
        eq: () => { updates.push(fields); return Promise.resolve({ error: null }) },
      }),
    }),
  }
}

function profile(): UserProfile {
  return {
    goals: 'Climb better', events: [{ name: 'E', date: '2026-07-01', type: 'sportive', priority: 'A' }],
    weekly_availability: [{ day: 'monday', duration_minutes: 60 }],
    current_ftp: 200, weight_kg: 70, intervals_icu_athlete_id: 'i', intervals_icu_api_key: 'k',
  }
}

function request(overrides: Partial<GeneratePlanJobRequest> = {}): GeneratePlanJobRequest {
  return {
    kind: 'generate', userId: 'u1', totalWeeks: 1, startDate: '2026-06-01', notes: '',
    trainingPhilosophy: null, profile: profile(), recentActivitiesSummary: 'No recent activities.',
    athleteStateLine: 'CTL: 50', ...overrides,
  }
}

describe('runGeneratePlanJob', () => {
  beforeEach(() => {
    mockInterpretGoals.mockReset().mockResolvedValue({ emphasis: { climbing: 0.5, speed: 0.5, enduranceVolume: 0.5, weightLoss: 0.5 }, rationale: 'r' })
    mockFillSession.mockReset()
    mockFallbackSession.mockReset().mockReturnValue({
      description: 'fallback', target_zones: 'Zone 2', steps: [{ label: 'Steady', duration_minutes: 60, power_pct_ftp: 65 }], coaching_notes: { summary: 's', focus: [] },
    })
    mockSendPush.mockReset()
  })

  it('marks the job done with a GeneratedPlan built from filled sessions', async () => {
    mockFillSession.mockResolvedValue({
      description: 'd', target_zones: 'z', steps: [{ label: 'Ride', duration_minutes: 60, power_pct_ftp: 65 }], coaching_notes: { summary: 's', focus: [] },
    })
    const supabase = makeSupabase()
    await runGeneratePlanJob(supabase as never, 'job1', request())

    const done = supabase.updates.find(u => u.status === 'done')
    expect(done).toBeDefined()
    const plan = done!.result as { rationale: string; workouts: Array<{ date: string; description: string }> }
    expect(plan.rationale).toBe('r')
    expect(plan.workouts.some(w => w.date === '2026-06-01')).toBe(true)
  })

  it('falls back to a safe session after two failed fill attempts, without failing the job', async () => {
    mockFillSession.mockRejectedValue(new Error('Claude error'))
    const supabase = makeSupabase()
    await runGeneratePlanJob(supabase as never, 'job1', request())

    expect(mockFillSession).toHaveBeenCalledTimes(2) // one retry
    expect(mockFallbackSession).toHaveBeenCalledTimes(1)
    const done = supabase.updates.find(u => u.status === 'done')
    expect(done).toBeDefined()
    const progress = supabase.updates[supabase.updates.length - 2]?.progress as { failed_days: string[] } | undefined
    expect(done!.progress).toMatchObject({ failed_days: ['2026-06-01'] })
  })

  it('marks the job as error when the profile has no events', async () => {
    const supabase = makeSupabase()
    await runGeneratePlanJob(supabase as never, 'job1', request({ profile: { ...profile(), events: [] } }))
    const errored = supabase.updates.find(u => u.status === 'error')
    expect(errored).toBeDefined()
  })

  it('sends a push notification on completion when a subscription is provided', async () => {
    mockFillSession.mockResolvedValue({
      description: 'd', target_zones: 'z', steps: [{ label: 'Ride', duration_minutes: 60, power_pct_ftp: 65 }], coaching_notes: { summary: 's', focus: [] },
    })
    const supabase = makeSupabase()
    await runGeneratePlanJob(supabase as never, 'job1', request({
      pushSubscription: { endpoint: 'https://push.example/1', p256dh: 'p', auth: 'a' },
    }))
    expect(mockSendPush).toHaveBeenCalledWith(
      { endpoint: 'https://push.example/1', p256dh: 'p', auth: 'a' },
      expect.objectContaining({ title: expect.stringContaining('plan') }),
    )
  })

  it('does not attempt a push when no subscription was provided', async () => {
    mockFillSession.mockResolvedValue({
      description: 'd', target_zones: 'z', steps: [{ label: 'Ride', duration_minutes: 60, power_pct_ftp: 65 }], coaching_notes: { summary: 's', focus: [] },
    })
    const supabase = makeSupabase()
    await runGeneratePlanJob(supabase as never, 'job1', request())
    expect(mockSendPush).not.toHaveBeenCalled()
  })

  it('does not fail the job when the push send itself throws', async () => {
    mockSendPush.mockRejectedValue(new Error('push service down'))
    mockFillSession.mockResolvedValue({
      description: 'd', target_zones: 'z', steps: [{ label: 'Ride', duration_minutes: 60, power_pct_ftp: 65 }], coaching_notes: { summary: 's', focus: [] },
    })
    const supabase = makeSupabase()
    await runGeneratePlanJob(supabase as never, 'job1', request({
      pushSubscription: { endpoint: 'https://push.example/1', p256dh: 'p', auth: 'a' },
    }))
    const done = supabase.updates.find(u => u.status === 'done')
    expect(done).toBeDefined()
  })
})

describe('runPlanJob — review', () => {
  beforeEach(() => {
    mockInterpretGoals.mockReset().mockResolvedValue({ emphasis: { climbing: 0.5, speed: 0.5, enduranceVolume: 0.5, weightLoss: 0.5 }, rationale: 'r' })
    mockFillSession.mockReset().mockResolvedValue({
      description: 'd', target_zones: 'z', steps: [{ label: 'Ride', duration_minutes: 60, power_pct_ftp: 65 }], coaching_notes: { summary: 's', focus: [] },
    })
  })

  it('keeps the plan\'s existing rationale and target event rather than re-deriving them', async () => {
    const supabase = makeSupabase()
    await runPlanJob(supabase as never, 'job1', {
      kind: 'review', userId: 'u1', planStartDate: '2026-06-01', phases: ['base'],
      fromDate: '2026-06-01', toDate: '2026-06-07', loadMultiplier: 1, note: '',
      profile: profile(), recentActivitiesSummary: 'No recent activities.', athleteStateLine: 'CTL: 50',
      priorRationale: 'Original rationale', priorTargetEventName: 'Dragon Ride', priorTargetEventDate: '2026-09-01',
    })
    const done = supabase.updates.find(u => u.status === 'done')
    const plan = done!.result as { rationale: string; target_event_name: string }
    expect(plan.rationale).toBe('Original rationale')
    expect(plan.target_event_name).toBe('Dragon Ride')
    expect(mockInterpretGoals).not.toHaveBeenCalled() // review doesn't re-derive emphasis from goals
  })

  it('scales scheduled durations by loadMultiplier', async () => {
    const supabase = makeSupabase()
    await runPlanJob(supabase as never, 'job1', {
      kind: 'review', userId: 'u1', planStartDate: '2026-06-01', phases: ['base'],
      fromDate: '2026-06-01', toDate: '2026-06-01', loadMultiplier: 0.5, note: '',
      profile: { ...profile(), weekly_availability: [{ day: 'monday', duration_minutes: 60 }] },
      recentActivitiesSummary: '', athleteStateLine: '',
      priorRationale: 'r', priorTargetEventName: 'E', priorTargetEventDate: '2026-09-01',
    })
    expect(mockFillSession).toHaveBeenCalledWith(
      expect.objectContaining({ durationMinutes: 30 }), // 60 * 0.5, rounded to nearest 5
      expect.anything(),
    )
  })
})

describe('runPlanJob — extend', () => {
  it('schedules only the newly appended weeks and returns the new total week count via week_phases length', async () => {
    mockFillSession.mockReset().mockResolvedValue({
      description: 'd', target_zones: 'z', steps: [{ label: 'Ride', duration_minutes: 60, power_pct_ftp: 65 }], coaching_notes: { summary: 's', focus: [] },
    })
    const supabase = makeSupabase()
    await runPlanJob(supabase as never, 'job1', {
      kind: 'extend', userId: 'u1', planStartDate: '2026-06-01', phases: ['base', 'base'],
      fromDate: '2026-06-08', toDate: '2026-06-14', trainingPhilosophy: null,
      profile: { ...profile(), weekly_availability: [{ day: 'monday', duration_minutes: 60 }] },
      recentActivitiesSummary: '', athleteStateLine: '',
      priorRationale: 'r', priorTargetEventName: 'E', priorTargetEventDate: '2026-09-01',
    })
    const done = supabase.updates.find(u => u.status === 'done')
    const plan = done!.result as { workouts: Array<{ date: string }>; week_phases: string[] }
    expect(plan.workouts.every(w => w.date >= '2026-06-08')).toBe(true)
    expect(plan.week_phases).toEqual(['base', 'base'])
  })
})
