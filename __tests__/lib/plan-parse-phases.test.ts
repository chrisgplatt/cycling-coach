import { parsePlanText } from '@/lib/claude/plan'

jest.mock('@/lib/claude/client', () => ({
  MODEL: 'claude-opus-5',
  anthropic: { messages: { create: jest.fn(), stream: jest.fn() } },
}))

it('preserves week_phases through plan parsing', () => {
  const json = JSON.stringify({
    rationale: 'r', target_event_name: 'E', target_event_date: '2026-07-01',
    phase: 'build', week_phases: ['base', 'build', 'peak', 'taper'],
    workouts: [{ date: '2026-06-01', type: 'endurance', duration_minutes: 60, description: 'd', target_zones: 'z2', steps: null }],
  })
  expect(parsePlanText(json).week_phases).toEqual(['base', 'build', 'peak', 'taper'])
})
