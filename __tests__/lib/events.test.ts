import { eventEndDate, eventCoversDate, eventDurationDays, eventDateRangeLabel, eventBlockStatusLabel, estimateEventTss } from '@/lib/events'
import type { TrainingEvent } from '@/types'

const singleDay: Pick<TrainingEvent, 'date' | 'end_date'> = { date: '2026-08-10' }
const range: Pick<TrainingEvent, 'date' | 'end_date'> = { date: '2026-08-10', end_date: '2026-08-17' }

describe('eventEndDate', () => {
  it('falls back to date when end_date is absent', () => {
    expect(eventEndDate(singleDay)).toBe('2026-08-10')
  })

  it('returns end_date when present', () => {
    expect(eventEndDate(range)).toBe('2026-08-17')
  })
})

describe('eventCoversDate', () => {
  it('matches the single date for a single-day event', () => {
    expect(eventCoversDate(singleDay, '2026-08-10')).toBe(true)
    expect(eventCoversDate(singleDay, '2026-08-11')).toBe(false)
  })

  it('matches every date inside a multi-day range, inclusive of both ends', () => {
    expect(eventCoversDate(range, '2026-08-10')).toBe(true)
    expect(eventCoversDate(range, '2026-08-13')).toBe(true)
    expect(eventCoversDate(range, '2026-08-17')).toBe(true)
    expect(eventCoversDate(range, '2026-08-09')).toBe(false)
    expect(eventCoversDate(range, '2026-08-18')).toBe(false)
  })
})

describe('eventDurationDays', () => {
  it('is 1 for a single-day event', () => {
    expect(eventDurationDays(singleDay)).toBe(1)
  })

  it('counts inclusively for a multi-day range', () => {
    expect(eventDurationDays(range)).toBe(8)
  })
})

describe('estimateEventTss (unchanged, still exported alongside the new helpers)', () => {
  it('returns null when duration_minutes is absent', () => {
    expect(estimateEventTss({ duration_minutes: undefined, rpe: undefined })).toBeNull()
  })
})

describe('eventDateRangeLabel', () => {
  it('returns the plain date for a single-day event', () => {
    expect(eventDateRangeLabel(singleDay)).toBe('2026-08-10')
  })

  it('returns a "start to end" label for a multi-day event', () => {
    expect(eventDateRangeLabel(range)).toBe('2026-08-10 to 2026-08-17')
  })
})

describe('eventBlockStatusLabel', () => {
  it('returns BLOCKED for a non-holiday event', () => {
    expect(eventBlockStatusLabel({ type: 'race', continue_training: undefined })).toBe('BLOCKED')
  })

  it('returns BLOCKED for a holiday without continue_training', () => {
    expect(eventBlockStatusLabel({ type: 'holiday', continue_training: undefined })).toBe('BLOCKED')
  })

  it('returns the continue-training phrase for a continue-training holiday', () => {
    expect(eventBlockStatusLabel({ type: 'holiday', continue_training: true }))
      .toBe('NOT BLOCKED — self-directed riding, optional quality sessions only (no mandatory workout)')
  })
})
