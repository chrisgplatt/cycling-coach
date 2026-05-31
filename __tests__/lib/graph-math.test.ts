/** @jest-environment node */
import { pointerToIndex, seriesToPolyline, formatDuration } from '@/lib/ride/graph-math'

describe('pointerToIndex', () => {
  it('maps an x position within the rect to a clamped sample index', () => {
    expect(pointerToIndex(0, 0, 100, 11)).toBe(0)
    expect(pointerToIndex(50, 0, 100, 11)).toBe(5)
    expect(pointerToIndex(100, 0, 100, 11)).toBe(10)
    expect(pointerToIndex(200, 0, 100, 11)).toBe(10) // clamp past the end
    expect(pointerToIndex(-50, 0, 100, 11)).toBe(0)  // clamp before the start
  })
})

describe('seriesToPolyline', () => {
  it('scales values into the box and skips nulls', () => {
    const pts = seriesToPolyline([0, 50, 100], 100, 100, 0)
    // min=0,max=100 → y inverted: 0→100, 50→50, 100→0; x evenly 0,50,100
    expect(pts).toBe('0.0,100.0 50.0,50.0 100.0,0.0')
  })
  it('returns empty string with no numeric values', () => {
    expect(seriesToPolyline([null, null], 100, 100, 0)).toBe('')
  })
})

describe('formatDuration', () => {
  it('formats seconds as H:MM:SS / M:SS', () => {
    expect(formatDuration(75)).toBe('1:15')
    expect(formatDuration(3675)).toBe('1:01:15')
  })
})
