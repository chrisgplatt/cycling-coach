import { formatReportedSignals } from '@/lib/claude/feedback-signals'

describe('formatReportedSignals', () => {
  it('renders all signals as a single dot-separated line', () => {
    expect(formatReportedSignals({
      rpe: 7, feel: 2, completion: 'cut_short', tags: ['poor_sleep', 'niggle'],
    })).toBe('RPE 7/10 · legs good (2/5) · cut short · flags: poor sleep, niggle')
  })

  it('labels a poor legs score with unambiguous sentiment, not just a bare fraction', () => {
    // feel=4 corresponds to the 😣 face (WorkoutFeedbackTab's FEEL_FACES, 1=best/5=worst) —
    // a bare "legs 4/5" reads as a good score to anyone without that scale's context,
    // which previously led the coaching prompt to describe tired legs as "feeling fresh".
    expect(formatReportedSignals({ feel: 4 })).toBe('legs tired (4/5)')
    expect(formatReportedSignals({ feel: 5 })).toBe('legs exhausted (5/5)')
    expect(formatReportedSignals({ feel: 1 })).toBe('legs great (1/5)')
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
