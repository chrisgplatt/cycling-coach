/** @jest-environment node */
const mockCreate = jest.fn()
jest.mock('@/lib/claude/client', () => ({ anthropic: { messages: { create: (...args: unknown[]) => mockCreate(...args) } }, PLAN_MODEL: 'claude-sonnet-5' }))

import { interpretGoals } from '@/lib/claude/plan-emphasis'

function textResponse(json: unknown) {
  return { content: [{ type: 'text', text: JSON.stringify(json) }] }
}

describe('interpretGoals', () => {
  beforeEach(() => mockCreate.mockReset())

  it('parses the emphasis weights and rationale from Claude\'s response', async () => {
    mockCreate.mockResolvedValue(textResponse({
      climbing: 0.8, speed: 0.1, enduranceVolume: 0.3, weightLoss: 0.1, rationale: 'Climb-focused plan.',
    }))
    const result = await interpretGoals('I want to climb better', '')
    expect(result.emphasis).toEqual({ climbing: 0.8, speed: 0.1, enduranceVolume: 0.3, weightLoss: 0.1 })
    expect(result.rationale).toBe('Climb-focused plan.')
  })

  it('reads the text block even when a thinking block comes first', async () => {
    mockCreate.mockResolvedValue({ content: [
      { type: 'thinking', thinking: '' },
      { type: 'text', text: JSON.stringify({ climbing: 0.9, speed: 0.1, enduranceVolume: 0.2, weightLoss: 0, rationale: 'Climbs.' }) },
    ] })
    const result = await interpretGoals('climb', '')
    expect(result.emphasis.climbing).toBe(0.9)
    expect(result.rationale).toBe('Climbs.')
  })

  it('strips a markdown code fence before parsing', async () => {
    mockCreate.mockResolvedValue(textResponse({ climbing: 0.5, speed: 0.5, enduranceVolume: 0.5, weightLoss: 0.5, rationale: 'r' }))
    mockCreate.mockResolvedValueOnce({ content: [{ type: 'text', text: '```json\n{"climbing":0.5,"speed":0.5,"enduranceVolume":0.5,"weightLoss":0.5,"rationale":"r"}\n```' }] })
    const result = await interpretGoals('goals', '')
    expect(result.emphasis.climbing).toBe(0.5)
  })

  it('falls back to an even emphasis and a generic rationale when Claude errors', async () => {
    mockCreate.mockRejectedValue(new Error('API down'))
    const result = await interpretGoals('Finish my first gran fondo', '')
    expect(result.emphasis).toEqual({ climbing: 0.25, speed: 0.25, enduranceVolume: 0.25, weightLoss: 0.25 })
    expect(result.rationale).toContain('Finish my first gran fondo')
  })

  it('falls back cleanly when the response is not valid JSON', async () => {
    mockCreate.mockResolvedValue(textResponse('not json'))
    mockCreate.mockResolvedValueOnce({ content: [{ type: 'text', text: 'not json at all' }] })
    const result = await interpretGoals('goals', '')
    expect(result.emphasis).toEqual({ climbing: 0.25, speed: 0.25, enduranceVolume: 0.25, weightLoss: 0.25 })
  })
})
