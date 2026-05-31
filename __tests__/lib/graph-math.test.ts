/** @jest-environment node */
import { pointerToIndex, seriesToPolyline, formatDuration, axisFractions, nearestIndexForFraction } from '@/lib/ride/graph-math'

describe('axisFractions', () => {
  it('maps a uniform monotonic axis to 0..1', () => {
    expect(axisFractions([0, 50, 100])).toEqual([0, 0.5, 1])
  })
  it('reflects non-uniform spacing', () => {
    expect(axisFractions([0, 10, 100])).toEqual([0, 0.1, 1])
  })
  it('falls back to even spacing when the axis has zero span', () => {
    expect(axisFractions([5, 5, 5])).toEqual([0, 0.5, 1])
  })
})

describe('nearestIndexForFraction', () => {
  it('returns the index of the closest fraction', () => {
    const f = [0, 0.1, 1]
    expect(nearestIndexForFraction(f, 0.04)).toBe(0)
    expect(nearestIndexForFraction(f, 0.4)).toBe(1) // 0.1 is closer than 1
    expect(nearestIndexForFraction(f, 0.6)).toBe(2)
  })
})

describe('seriesToPolyline with explicit x fractions', () => {
  it('places points along the given axis fractions', () => {
    // values 0,100 with fractions 0,0.25 → x = 0, 25; y inverted 100→100, ... wait
    const pts = seriesToPolyline([0, 100], 100, 100, 0, [0, 0.25])
    expect(pts).toBe('0.0,100.0 25.0,0.0')
  })
})

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
