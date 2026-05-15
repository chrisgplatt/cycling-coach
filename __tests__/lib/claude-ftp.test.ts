import { predictFTP } from '@/lib/claude/ftp'
import type { FTPPredictionInput } from '@/lib/claude/ftp'

jest.mock('@/lib/claude/client', () => ({
  MODEL: 'claude-sonnet-4-6',
  anthropic: { messages: { create: jest.fn() } },
}))

import { anthropic } from '@/lib/claude/client'
const mockCreate = anthropic.messages.create as jest.Mock

const input: FTPPredictionInput = {
  powerCurve: { mins5: 380, mins20: 320, mins60: 275 },
  algorithmicEstimate: 304,
  monthlyTrend: [
    { month: '2026-03', rideCount: 8, peakNP: 290, totalTSS: 520 },
    { month: '2026-04', rideCount: 9, peakNP: 310, totalTSS: 580 },
    { month: '2026-05', rideCount: 5, peakNP: 320, totalTSS: 340 },
  ],
  currentFTP: 290,
}

describe('predictFTP', () => {
  beforeEach(() => mockCreate.mockReset())

  it('returns predicted FTP with reasoning', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: JSON.stringify({ predicted_ftp: 304, reasoning: 'Best 20-min of 320W gives 304W at 95%', confidence: 'high' }) }],
    })

    const result = await predictFTP(input)
    expect(result.predicted_ftp).toBe(304)
    expect(result.confidence).toBe('high')
    expect(typeof result.reasoning).toBe('string')
  })

  it('handles null power curve values', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: JSON.stringify({ predicted_ftp: 280, reasoning: 'No 20-min effort available', confidence: 'low' }) }],
    })

    const result = await predictFTP({
      ...input,
      powerCurve: { mins5: 380, mins20: null, mins60: null },
      algorithmicEstimate: null,
    })
    expect(result.confidence).toBe('low')
  })

  it('throws on unparseable Claude response', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'not valid json' }],
    })

    await expect(predictFTP(input)).rejects.toThrow('Failed to parse FTP prediction')
  })
})
