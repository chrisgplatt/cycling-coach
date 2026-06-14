import { generateProgressBrief } from '@/lib/claude/progress-brief'

jest.mock('@/lib/claude/client', () => ({
  anthropic: { messages: { create: jest.fn() } },
}))

import { anthropic } from '@/lib/claude/client'
const mockCreate = anthropic.messages.create as jest.Mock

const metrics = {
  ftp: { current: 245, baseline: 230, delta: 15 },
  ctl: { current: 70, baseline: 55, delta: 15 },
  weight: null,
  adherence: { completed: 14, total: 16 },
  streak: null,
  totalRides: null,
  planPhase: 'build',
  targetEvent: 'Dragon Ride',
  targetDate: '2026-09-01',
  planStartDate: '2026-04-01',
}

beforeEach(() => mockCreate.mockReset())

describe('generateProgressBrief', () => {
  it('returns the content string from Claude response', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: '{"content": "Your fitness is building well."}' }],
    })
    const result = await generateProgressBrief({ metrics, goals: 'Gran fondo completion' })
    expect(result).toBe('Your fitness is building well.')
  })

  it('returns null and skips the API call when all key metrics are absent', async () => {
    const empty = { ...metrics, ctl: null, ftp: null, adherence: null }
    const result = await generateProgressBrief({ metrics: empty, goals: '' })
    expect(result).toBeNull()
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('returns null when Claude returns unparseable JSON', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'not json at all' }],
    })
    const result = await generateProgressBrief({ metrics, goals: '' })
    expect(result).toBeNull()
  })

  it('strips markdown code fences before parsing', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: '```json\n{"content": "Good progress."}\n```' }],
    })
    const result = await generateProgressBrief({ metrics, goals: '' })
    expect(result).toBe('Good progress.')
  })
})
