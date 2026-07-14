import { isSessionCountable, isSessionCompleted } from '@/lib/progress/session-counting'

describe('isSessionCountable', () => {
  it('always counts a non-optional workout regardless of status', () => {
    expect(isSessionCountable({ status: 'planned' })).toBe(true)
    expect(isSessionCountable({ status: 'skipped' })).toBe(true)
    expect(isSessionCountable({ status: 'completed' })).toBe(true)
    expect(isSessionCountable({ status: 'needs_review' })).toBe(true)
  })

  it('excludes a pending or skipped optional workout', () => {
    expect(isSessionCountable({ status: 'planned', optional: true })).toBe(false)
    expect(isSessionCountable({ status: 'skipped', optional: true })).toBe(false)
  })

  it('counts a completed or needs_review optional workout', () => {
    expect(isSessionCountable({ status: 'completed', optional: true })).toBe(true)
    expect(isSessionCountable({ status: 'needs_review', optional: true })).toBe(true)
  })
})

describe('isSessionCompleted', () => {
  it('counts a completed workout regardless of optional', () => {
    expect(isSessionCompleted({ status: 'completed' })).toBe(true)
    expect(isSessionCompleted({ status: 'completed', optional: true })).toBe(true)
  })

  it('counts an optional needs_review workout as completed', () => {
    expect(isSessionCompleted({ status: 'needs_review', optional: true })).toBe(true)
  })

  it('does not count a non-optional needs_review workout as completed', () => {
    expect(isSessionCompleted({ status: 'needs_review' })).toBe(false)
  })

  it('does not count a planned or skipped workout as completed', () => {
    expect(isSessionCompleted({ status: 'planned' })).toBe(false)
    expect(isSessionCompleted({ status: 'skipped' })).toBe(false)
    expect(isSessionCompleted({ status: 'planned', optional: true })).toBe(false)
    expect(isSessionCompleted({ status: 'skipped', optional: true })).toBe(false)
  })
})
