import { resolveBikeForRide, type BikeRef } from '@/lib/gear/resolve-bike'

const road: BikeRef = { id: 'road', is_default: true, is_indoor_default: false, retired_at: null }
const trainer: BikeRef = { id: 'trainer', is_default: false, is_indoor_default: true, retired_at: null }

describe('resolveBikeForRide', () => {
  it('sends outdoor rides to the default bike', () => {
    expect(resolveBikeForRide({ isIndoor: false }, [road, trainer])).toBe('road')
  })
  it('sends indoor rides to the trainer bike when one exists', () => {
    expect(resolveBikeForRide({ isIndoor: true }, [road, trainer])).toBe('trainer')
  })
  it('falls back to the default bike for indoor rides with no trainer bike', () => {
    expect(resolveBikeForRide({ isIndoor: true }, [road])).toBe('road')
  })
  it('ignores retired bikes', () => {
    const retired = { ...trainer, retired_at: '2026-01-01T00:00:00Z' }
    expect(resolveBikeForRide({ isIndoor: true }, [road, retired])).toBe('road')
  })
  it('returns null when there is no default bike', () => {
    expect(resolveBikeForRide({ isIndoor: false }, [])).toBeNull()
  })
})
