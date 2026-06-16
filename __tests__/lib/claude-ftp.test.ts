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
  cpModel: { cp: 295, wPrimeJ: 18000, pointsUsed: 5 },
  algorithmicEstimate: 304,
  monthlyTrend: [
    { month: '2026-03', rideCount: 8, peakNP: 290, totalTSS: 520 },
    { month: '2026-04', rideCount: 9, peakNP: 310, totalTSS: 580 },
    { month: '2026-05', rideCount: 5, peakNP: 320, totalTSS: 340 },
  ],
  dossierText: "COACH'S NOTES ON THIS ATHLETE (last updated: today):\nAs a rider: Strong endurance rider.",
  recentThresholdFeedback: [
    { date: '2026-05-20', rpe: 7, feel: 3, feedbackText: 'Felt strong throughout.' },
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
      cpModel: null,
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

  it('includes CP model, dossier, and feedback in the prompt sent to Claude', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: JSON.stringify({ predicted_ftp: 295, reasoning: 'test', confidence: 'medium' }) }],
    })

    await predictFTP(input)

    const sentPrompt = mockCreate.mock.calls[0][0].messages[0].content as string
    expect(sentPrompt).toContain('CP ≈ 295W')
    expect(sentPrompt).toContain("W' ≈ 18.0kJ")
    expect(sentPrompt).toContain(input.dossierText)
    expect(sentPrompt).toContain('RPE 7/10')
    expect(sentPrompt).toContain('Felt strong throughout.')
  })

  it('shows "unavailable" CP model and "no feedback" message when absent', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: JSON.stringify({ predicted_ftp: 280, reasoning: 'test', confidence: 'low' }) }],
    })

    await predictFTP({
      ...input,
      cpModel: null,
      recentThresholdFeedback: [],
    })

    const sentPrompt = mockCreate.mock.calls[0][0].messages[0].content as string
    expect(sentPrompt).toContain('Critical Power model: unavailable')
    expect(sentPrompt).toContain('No threshold/intervals session feedback in the last 60 days.')
  })
})
