/**
 * @jest-environment node
 */
import { wordOverlap } from '@/app/api/dossier/notes/route'

describe('wordOverlap', () => {
  it('returns 1 for identical strings', () => {
    expect(wordOverlap('knee pain on climbs', 'knee pain on climbs')).toBe(1)
  })

  it('returns 0 for completely different strings', () => {
    expect(wordOverlap('knee pain', 'morning training')).toBe(0)
  })

  it('returns partial score for partial overlap', () => {
    const score = wordOverlap('left knee flares up on long climbs', 'knee flares up')
    expect(score).toBeGreaterThan(0)
    expect(score).toBeLessThan(1)
  })

  it('selects the closest matching note for forget', () => {
    const notes = [
      'Left knee flares up on long climbs',
      'Can only do long rides on weekends',
    ]
    const target = 'knee flares up on climbs'
    let bestIdx = -1; let bestScore = 0
    notes.forEach((n, i) => {
      const s = wordOverlap(n.toLowerCase(), target.toLowerCase())
      if (s > bestScore) { bestScore = s; bestIdx = i }
    })
    expect(bestIdx).toBe(0)
  })

  it('handles empty strings without throwing', () => {
    expect(wordOverlap('', '')).toBe(0)
    expect(wordOverlap('knee pain', '')).toBe(0)
  })
})
