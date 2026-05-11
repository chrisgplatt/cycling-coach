import { predictFTP } from '@/lib/claude/ftp'
import type { ICUActivity } from '@/types'

jest.mock('@/lib/claude/client', () => ({
  MODEL: 'claude-sonnet-4-6',
  anthropic: { messages: { create: jest.fn() } },
}))

import { anthropic } from '@/lib/claude/client'
const mockCreate = anthropic.messages.create as jest.Mock

const activities: ICUActivity[] = [
  { id: 'a1', start_date_local: '2026-05-01T08:00:00', type: 'Ride',
    moving_time: 4500, name: 'Hard Group Ride', average_watts: 220,
    max_watts: 420, weighted_average_watts: 245, average_heartrate: 162,
    training_load: 110 },
]

describe('predictFTP', () => {
  it('returns predicted FTP with reasoning', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: JSON.stringify({ predicted_ftp: 252, reasoning: 'Based on 20min best power', confidence: 'medium' }) }],
    })

    const result = await predictFTP(activities, 240)
    expect(result.predicted_ftp).toBe(252)
    expect(result.confidence).toBe('medium')
    expect(typeof result.reasoning).toBe('string')
  })
})
