import { formatReportedSignals } from '@/lib/claude/feedback-signals'

describe('formatReportedSignals', () => {
  it('renders all signals as a single dot-separated line', () => {
    expect(formatReportedSignals({
      rpe: 7, feel: 2, completion: 'cut_short', tags: ['poor_sleep', 'niggle'],
    })).toBe('RPE 7/10 · legs 2/5 · cut short · flags: poor sleep, niggle')
  })

  it('omits null/empty parts', () => {
    expect(formatReportedSignals({ rpe: 4, feel: null, completion: null, tags: [] }))
      .toBe('RPE 4/10')
  })

  it('returns an empty string when nothing is reported', () => {
    expect(formatReportedSignals({})).toBe('')
  })

  it('maps each completion value to a readable label', () => {
    expect(formatReportedSignals({ completion: 'as_planned' })).toBe('completed as planned')
    expect(formatReportedSignals({ completion: 'went_harder' })).toBe('went harder than planned')
    expect(formatReportedSignals({ completion: 'modified' })).toBe('modified')
  })
})
