import { derivePhases, resolvePhases } from '@/lib/plan/phases'

describe('derivePhases', () => {
  it('produces base→build→peak→taper for a ramp-then-taper load series', () => {
    const tss = [50, 60, 70, 80, 90, 100, 70, 40]
    expect(derivePhases(tss, 8)).toEqual([
      'base', 'base', 'build', 'build', 'peak', 'peak', 'taper', 'taper',
    ])
  })

  it('returns all base when there is no load', () => {
    expect(derivePhases([0, 0, 0], 3)).toEqual(['base', 'base', 'base'])
  })

  it('forces a final taper week on a long plan that never drops off', () => {
    const phases = derivePhases([60, 70, 80, 90, 100], 5)
    expect(phases[4]).toBe('taper')
  })
})

describe('resolvePhases', () => {
  it('prefers valid stored phases', () => {
    const stored = ['base', 'build', 'peak', 'taper'] as const
    expect(resolvePhases([...stored], [10, 20, 30, 5], 4)).toEqual([...stored])
  })

  it('falls back to derivation when stored is missing or wrong length', () => {
    expect(resolvePhases(null, [0, 0], 2)).toEqual(['base', 'base'])
    expect(resolvePhases(['base'], [0, 0], 2)).toEqual(['base', 'base'])
  })
})
