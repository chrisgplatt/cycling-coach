import { analyseFeedback } from '@/lib/claude/feedback'
import type { Workout, ProposedAdjustment } from '@/types'
import { formatDossier } from '@/lib/claude/dossier'
import type { AthleteDossier } from '@/lib/claude/dossier'

const mockFinalMessage = jest.fn()
jest.mock('@/lib/claude/client', () => ({
  MODEL: 'claude-sonnet-4-6',
  anthropic: {
    messages: {
      create: jest.fn(),
      stream: jest.fn(() => ({ finalMessage: mockFinalMessage })),
    },
  },
}))

import { anthropic } from '@/lib/claude/client'
const mockCreate = anthropic.messages.create as jest.Mock
const mockStream = anthropic.messages.stream as jest.Mock

const workout: Workout = {
  id: 'wk1', plan_id: 'p1', date: '2026-05-10',
  type: 'threshold', duration_minutes: 60,
  description: '2x20min at threshold', target_zones: 'Zone 4 (91-105% FTP)',
  intervals_icu_event_id: null, status: 'completed',
  icu_activity_id: null, tss: null, missed_reason: null, steps: null,
  created_at: '',
}

const upcomingWorkouts: Workout[] = [
  { ...workout, id: 'wk2', date: '2026-05-12', type: 'endurance',
    duration_minutes: 90, description: 'Zone 2 ride', status: 'planned', icu_activity_id: null, tss: null },
]

describe('analyseFeedback', () => {
  it('returns ProposedAdjustment with changes', async () => {
    const adjustment: ProposedAdjustment = {
      summary: 'Reduce Wednesday intensity due to reported fatigue',
      changes: [{
        workout_id: 'wk2', field: 'duration_minutes',
        old_value: 90, new_value: 60, reason: 'Athlete reported heavy legs',
      }],
    }
    mockFinalMessage.mockResolvedValueOnce({
      content: [{ type: 'text', text: JSON.stringify(adjustment) }],
    })

    const result = await analyseFeedback(
      workout, 'Legs felt really heavy, barely held power', 75, 195, 155, upcomingWorkouts
    )
    expect(result.changes).toHaveLength(1)
    expect(result.changes[0].workout_id).toBe('wk2')
  })

  it('returns empty changes when no adjustment needed', async () => {
    const adjustment: ProposedAdjustment = { summary: 'No adjustments needed', changes: [] }
    mockFinalMessage.mockResolvedValueOnce({
      content: [{ type: 'text', text: JSON.stringify(adjustment) }],
    })

    const result = await analyseFeedback(
      workout, 'Felt great, hit all targets', 80, 240, 148, upcomingWorkouts
    )
    expect(result.changes).toHaveLength(0)
  })
})

const feedbackDossier: AthleteDossier = {
  id: 'd6',
  user_id: 'u1',
  synthesized_at: new Date().toISOString(),
  content: {
    as_rider: 'Committed racer with strong base.',
    strengths: ['Threshold power'],
    weaknesses: ['Sprint finish'],
    training_compliance: 'Rarely misses sessions.',
    recovery_profile: 'Handles back-to-back well.',
    event_performance: 'A-races always go to plan.',
    trajectory: 'Peak fitness in 4 weeks.',
  },
  explicit_notes: [],
  created_at: new Date().toISOString(),
}

describe('analyseFeedback — dossier injection', () => {
  it('accepts an 8th dossierSection argument', async () => {
    const dossierSection = formatDossier(feedbackDossier)
    const adjustment: ProposedAdjustment = { summary: 'No adjustments needed', changes: [], workout_steps: [] }
    mockFinalMessage.mockResolvedValueOnce({
      content: [{ type: 'text', text: JSON.stringify(adjustment) }],
    })

    await expect(
      analyseFeedback(
        workout,
        'Felt great, hit all the targets',
        250,
        null,
        null,
        [],
        [],
        dossierSection,
      )
    ).resolves.toBeDefined()
  })
})

describe('analyseFeedback — ride execution', () => {
  it('includes the ride execution block in the feedback prompt when provided', async () => {
    mockFinalMessage.mockResolvedValueOnce({
      content: [{ type: 'text', text: '{"summary":"ok","changes":[],"workout_steps":[]}' }],
    })
    const execution = 'Planned steps: Work 8min @ 95%\nActual intervals: Work 8:00 avg 244W HR 161'
    await analyseFeedback(
      { ...workout, steps: [{ label: 'Work', duration_minutes: 8, power_pct_ftp: 95 }] },
      'felt hard', 78, 244, 161, [], [], '', execution,
    )
    const lastCall = mockStream.mock.calls[mockStream.mock.calls.length - 1]
    const prompt = lastCall[0].messages[0].content
    expect(prompt).toContain('Actual intervals:')
    expect(prompt).toContain('Work 8:00 avg 244W')
  })
})
