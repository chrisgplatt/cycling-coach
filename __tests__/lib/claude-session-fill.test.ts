/** @jest-environment node */
const mockCreate = jest.fn()
jest.mock('@/lib/claude/client', () => ({ anthropic: { messages: { create: (...args: unknown[]) => mockCreate(...args) } }, PLAN_MODEL: 'claude-sonnet-5' }))

import { fillSession, fallbackSession } from '@/lib/claude/session-fill'
import type { ScheduledSession } from '@/lib/plan/scheduler'

function session(overrides: Partial<ScheduledSession> = {}): ScheduledSession {
  return {
    date: '2026-06-01', status: 'session', sessionKind: 'endurance', workoutType: 'endurance',
    durationMinutes: 60, phase: 'base', targetTss: 42, optional: false, ...overrides,
  }
}

const context = { athleteStateLine: 'CTL: 50', recentActivitiesSummary: 'No recent activities.', ftp: 200 }

function textResponse(json: unknown) {
  return { content: [{ type: 'text', text: JSON.stringify(json) }] }
}

describe('fillSession', () => {
  beforeEach(() => mockCreate.mockReset())

  it('returns the filled session when steps sum to the assigned duration', async () => {
    mockCreate.mockResolvedValue(textResponse({
      description: 'Steady endurance ride', target_zones: 'Zone 2 (56-75% FTP)',
      steps: [{ label: 'Ride', duration_minutes: 60, power_pct_ftp: 65 }],
      coaching_notes: { summary: 'Build the base.', focus: [] },
    }))
    const result = await fillSession(session(), context)
    expect(result.steps).toHaveLength(1)
    expect(result.description).toBe('Steady endurance ride')
  })

  it('throws when the steps do not sum to the assigned duration', async () => {
    mockCreate.mockResolvedValue(textResponse({
      description: 'd', target_zones: 'z',
      steps: [{ label: 'Ride', duration_minutes: 45, power_pct_ftp: 65 }],
      coaching_notes: { summary: 's', focus: [] },
    }))
    await expect(fillSession(session({ durationMinutes: 60 }), context)).rejects.toThrow(/Steps sum to 45/)
  })

  it('throws when the response has no steps', async () => {
    mockCreate.mockResolvedValue(textResponse({ description: 'd', target_zones: 'z', steps: [], coaching_notes: { summary: 's', focus: [] } }))
    await expect(fillSession(session(), context)).rejects.toThrow()
  })
})

describe('fallbackSession', () => {
  it('produces steps that sum exactly to the session duration', () => {
    const result = fallbackSession(session({ durationMinutes: 75 }))
    const total = result.steps.reduce((sum, s) => sum + s.duration_minutes, 0)
    expect(total).toBe(75)
  })
  it('uses zone 1 for a recovery session and zone 2 otherwise', () => {
    expect(fallbackSession(session({ sessionKind: 'recovery' })).target_zones).toMatch(/Zone 1/)
    expect(fallbackSession(session({ sessionKind: 'endurance' })).target_zones).toMatch(/Zone 2/)
  })
})
