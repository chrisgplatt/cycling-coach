// @ts-nocheck
jest.mock('@/lib/claude/client', () => ({
  MODEL: 'claude-opus-4-8',
  anthropic: {
    messages: {
      create: jest.fn(),
      stream: jest.fn(),
    },
  },
}))

import { buildPromptWithPhilosophy } from '@/lib/claude/plan'
import type { TrainingPhilosophy } from '@/types'

const philosophy: TrainingPhilosophy = {
  name: 'friel-polarised-base',
  label: 'Friel periodization · polarised base',
  phase_weeks: { base: 4, build: 5, peak: 1, taper: 2 },
  intensity_profile: 'polarised-base',
  weekly_hours_at_creation: 9,
  rationale: 'Based on your 9.0h/week schedule.',
}

describe('buildPromptWithPhilosophy', () => {
  it('returns a string containing the philosophy label', () => {
    const result = buildPromptWithPhilosophy(philosophy)
    expect(result).toContain('Friel periodization · polarised base')
  })

  it('includes phase weeks', () => {
    const result = buildPromptWithPhilosophy(philosophy)
    expect(result).toContain('Base: 4 weeks')
    expect(result).toContain('Build: 5 weeks')
    expect(result).toContain('Taper: 2 weeks')
  })

  it('includes intensity profile', () => {
    const result = buildPromptWithPhilosophy(philosophy)
    expect(result).toContain('polarised-base')
  })

  it('returns empty string for null philosophy', () => {
    const result = buildPromptWithPhilosophy(null)
    expect(result).toBe('')
  })

  it('excludes zero-week phases from output (no peak for short plan)', () => {
    const shortPlan: TrainingPhilosophy = {
      ...philosophy,
      phase_weeks: { base: 1, build: 2, peak: 0, taper: 1 },
    }
    const result = buildPromptWithPhilosophy(shortPlan)
    expect(result).not.toContain('Peak')
    expect(result).toContain('Base: 1 weeks')
    expect(result).toContain('Taper: 1 weeks')
  })

  it('returns empty string for undefined', () => {
    const result = buildPromptWithPhilosophy(undefined)
    expect(result).toBe('')
  })
})
