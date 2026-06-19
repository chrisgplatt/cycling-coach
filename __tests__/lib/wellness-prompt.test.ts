import { formatWellnessForPrompt } from '@/lib/claude/wellness-prompt'
import type { DailyWellness } from '@/types'

function w(overrides: Partial<DailyWellness>): DailyWellness {
  return {
    id: '1', user_id: 'u1', date: '2026-06-16',
    energy: null, leg_freshness: null, mood: null, stress: null, sleep_quality: null,
    created_at: '2026-06-16T08:00:00Z', updated_at: '2026-06-16T08:00:00Z',
    ...overrides,
  }
}

describe('formatWellnessForPrompt', () => {
  it('returns empty string when given an empty array', () => {
    expect(formatWellnessForPrompt([])).toBe('')
  })

  it('formats a full entry correctly', () => {
    const result = formatWellnessForPrompt([
      w({ date: '2026-06-16', energy: 4, leg_freshness: 3, mood: 4, stress: 2, sleep_quality: 5 }),
    ])
    expect(result).toContain('2026-06-16')
    expect(result).toContain('Energy 4')
    expect(result).toContain('Legs 3')
    expect(result).toContain('Mood 4')
    expect(result).toContain('Stress 2')
    expect(result).toContain('Sleep 5')
  })

  it('omits null fields from an entry', () => {
    const result = formatWellnessForPrompt([
      w({ date: '2026-06-16', energy: 3, leg_freshness: null, mood: null, stress: null, sleep_quality: null }),
    ])
    expect(result).toContain('Energy 3')
    expect(result).not.toContain('Legs')
    expect(result).not.toContain('Mood')
  })

  it('omits entries where all values are null', () => {
    const result = formatWellnessForPrompt([w({ date: '2026-06-16' })])
    expect(result).toBe('')
  })

  it('includes a note about the stress scale direction', () => {
    const result = formatWellnessForPrompt([
      w({ date: '2026-06-16', stress: 1 }),
    ])
    expect(result).toContain('Stress is inverted')
  })
})
