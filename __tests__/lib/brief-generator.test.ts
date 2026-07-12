import { maybeGenerateProgressBrief } from '@/lib/progress/brief-generator'
import { generateProgressBrief } from '@/lib/claude/progress-brief'
import type { ICUActivity, ICUSyncData } from '@/types'

jest.mock('@/lib/claude/progress-brief', () => ({
  generateProgressBrief: jest.fn(async () => 'Great progress this week.'),
}))

const mockedGenerateProgressBrief = generateProgressBrief as jest.Mock

function act(date: string, type: string = 'Ride'): ICUActivity {
  return { start_date_local: `${date}T09:00:00`, category: 'WORKOUT', name: 'Ride', type } as unknown as ICUActivity
}

const baseWellness = {
  atl: 60, form: -5, hrv: null, resting_hr: null, sleep_secs: null,
  body_battery_low: null, body_battery_high: null, stress_avg: null,
  stress_high: null, garmin_training_load: null, sleep_score: null,
}

const syncData: ICUSyncData = {
  // Within the trailing 6-week sync window this array always represents.
  activities: [act('2026-06-01'), act('2026-06-15')],
  wellness: [{ id: '2026-06-15', ctl: 60, ...baseWellness }],
  athlete_ftp: null,
  athlete_weight: null,
}

const profile = {
  current_ftp: 245,
  weight_kg: 73.5,
  goals: 'Dragon Ride',
  min_sessions_per_week: 3,
}

function makeSupabase(opts: {
  plan?: { id: string; created_at: string; baseline_ftp: number | null; phase: string; target_event_name: string; target_event_date: string } | null
  upsertSpy?: jest.Mock
  existingGeneratedAt?: string | null
}) {
  const { plan = null, upsertSpy = jest.fn(async () => ({ error: null })), existingGeneratedAt = null } = opts
  return {
    from: (table: string) => {
      if (table === 'progress_briefs') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: existingGeneratedAt ? { generated_at: existingGeneratedAt } : null }),
            }),
          }),
          upsert: upsertSpy,
        }
      }
      if (table === 'training_plans') {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: plan }) }) }) }
      }
      if (table === 'weight_log') {
        return { select: () => ({ eq: () => ({ order: async () => ({ data: [] }) }) }) }
      }
      if (table === 'workouts') {
        return { select: () => ({ eq: async () => ({ data: [] }) }) }
      }
      throw new Error(`unexpected table: ${table}`)
    },
  }
}

beforeEach(() => {
  mockedGenerateProgressBrief.mockClear()
  mockedGenerateProgressBrief.mockResolvedValue('Great progress this week.')
})

describe('maybeGenerateProgressBrief — rides count source', () => {
  it('fetches a plan-scoped activities range and uses it for the rides count when a plan is active', async () => {
    const plan = {
      id: 'p1',
      created_at: '2026-04-01T00:00:00Z', // well before the trailing 6-week sync window
      baseline_ftp: 230,
      phase: 'build',
      target_event_name: 'Dragon Ride',
      target_event_date: '2026-09-01',
    }
    const upsertSpy = jest.fn(async () => ({ error: null }))
    const supabase = makeSupabase({ plan, upsertSpy })

    // Includes a ride from before the trailing 6-week sync window (2026-04-10),
    // which syncData.activities does NOT contain — proves the fetched range,
    // not syncData.activities, drives the count.
    const client = {
      getActivities: jest.fn(async () => [act('2026-04-10'), act('2026-06-01'), act('2026-06-15')]),
    }

    await maybeGenerateProgressBrief(supabase as never, 'u1', syncData, profile, client as never)

    expect(client.getActivities).toHaveBeenCalledWith('2026-04-01', expect.any(String))
    expect(upsertSpy).toHaveBeenCalled()
    const written = (upsertSpy.mock.calls as unknown[][])[0]?.[0] as any
    expect(written.metrics_snapshot.totalRides).toBe(3)
  })

  it('does not call getActivities and uses syncData.activities directly when there is no active plan', async () => {
    // Build activity dates relative to the real "today" so this test can't
    // rot with the calendar — a hardcoded absolute date would eventually
    // fall outside the 42-day no-plan fallback window computeProgressMetrics uses.
    const today = new Date()
    const recent = new Date(today); recent.setDate(today.getDate() - 5)
    const old = new Date(today); old.setDate(today.getDate() - 100)
    const recentStr = recent.toISOString().split('T')[0]
    const oldStr = old.toISOString().split('T')[0]

    const localSyncData: ICUSyncData = { ...syncData, activities: [act(recentStr), act(oldStr)] }

    const upsertSpy = jest.fn(async () => ({ error: null }))
    const supabase = makeSupabase({ plan: null, upsertSpy })
    const client = { getActivities: jest.fn() }

    await maybeGenerateProgressBrief(supabase as never, 'u1', localSyncData, profile, client as never)

    expect(client.getActivities).not.toHaveBeenCalled()
    expect(upsertSpy).toHaveBeenCalled()
    const written = (upsertSpy.mock.calls as unknown[][])[0]?.[0] as any
    expect(written.metrics_snapshot.totalRides).toBe(1) // only the recent one — from syncData.activities directly
  })
})

describe('maybeGenerateProgressBrief — metrics/content debounce decoupling', () => {
  it('updates metrics_snapshot even within the debounce window when a brief row already exists, and skips content generation', async () => {
    const recentGeneratedAt = new Date(Date.now() - 1 * 3600000).toISOString() // 1 hour ago — within DEBOUNCE_HOURS=4
    const upsertSpy = jest.fn(async () => ({ error: null }))
    const supabase = makeSupabase({ plan: null, upsertSpy, existingGeneratedAt: recentGeneratedAt })
    const client = { getActivities: jest.fn() }

    const today = new Date()
    const recent = new Date(today); recent.setDate(today.getDate() - 5)
    const recentStr = recent.toISOString().split('T')[0]
    const localSyncData: ICUSyncData = { ...syncData, activities: [act(recentStr)] }

    await maybeGenerateProgressBrief(supabase as never, 'u1', localSyncData, profile, client as never)

    expect(upsertSpy).toHaveBeenCalledTimes(1)
    const written = (upsertSpy.mock.calls as unknown[][])[0]?.[0] as any
    expect(written).toEqual({ user_id: 'u1', metrics_snapshot: expect.objectContaining({ totalRides: 1 }) })
    expect(mockedGenerateProgressBrief).not.toHaveBeenCalled()
  })

  it('creates no row at all when there is no existing brief and metrics are too sparse for AI text', async () => {
    mockedGenerateProgressBrief.mockResolvedValueOnce(null)
    const upsertSpy = jest.fn(async () => ({ error: null }))
    const supabase = makeSupabase({ plan: null, upsertSpy })
    const client = { getActivities: jest.fn() }

    await maybeGenerateProgressBrief(
      supabase as never, 'u1', { ...syncData, activities: [] }, profile, client as never,
    )

    expect(upsertSpy).not.toHaveBeenCalled()
  })

  it('writes content, metrics_snapshot, and generated_at together when creating the first-ever brief', async () => {
    const upsertSpy = jest.fn(async () => ({ error: null }))
    const supabase = makeSupabase({ plan: null, upsertSpy })
    const client = { getActivities: jest.fn() }

    await maybeGenerateProgressBrief(supabase as never, 'u1', syncData, profile, client as never)

    expect(upsertSpy).toHaveBeenCalledTimes(1)
    const written = (upsertSpy.mock.calls as unknown[][])[0]?.[0] as any
    expect(written.content).toBe('Great progress this week.')
    expect(written.metrics_snapshot).toBeDefined()
    expect(written.generated_at).toEqual(expect.any(String))
  })
})
