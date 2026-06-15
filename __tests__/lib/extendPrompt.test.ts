import { buildExtendPrompt } from '@/lib/claude/plan'

jest.mock('@/lib/claude/client', () => ({
  MODEL: 'claude-sonnet-4-6',
  anthropic: {
    messages: {
      create: jest.fn(),
      stream: jest.fn(() => ({ on: jest.fn(), finalMessage: jest.fn() })),
    },
  },
}))

describe('buildExtendPrompt', () => {
  it('includes extra weeks count', () => {
    const result = buildExtendPrompt(3, { base: 4, build: 8, peak: 1, taper: 2 }, '2026-09-01')
    expect(result).toContain('3')
  })

  it('includes today date', () => {
    const result = buildExtendPrompt(3, { base: 4, build: 8, peak: 1, taper: 2 }, '2026-09-01')
    expect(result).toContain('2026-09-01')
  })

  it('includes phase summary', () => {
    const result = buildExtendPrompt(3, { base: 4, build: 8, peak: 1, taper: 2 }, '2026-09-01')
    expect(result).toContain('base 4wk')
    expect(result).toContain('build 8wk')
    expect(result).toContain('taper 2wk')
  })

  it('omits peak from summary when peak is 0', () => {
    const result = buildExtendPrompt(2, { base: 1, build: 2, peak: 0, taper: 1 }, '2026-09-01')
    expect(result).not.toContain('peak')
  })

  it('instructs not to generate sessions before todayDate', () => {
    const result = buildExtendPrompt(4, { base: 4, build: 8, peak: 1, taper: 2 }, '2026-08-15')
    expect(result).toMatch(/do not generate.*2026-08-15/i)
  })
})
