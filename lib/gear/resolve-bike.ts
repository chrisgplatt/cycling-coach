export interface BikeRef {
  id: string
  is_default: boolean
  is_indoor_default: boolean
  retired_at: string | null
}

export function resolveBikeForRide(ride: { isIndoor: boolean }, bikes: BikeRef[]): string | null {
  const active = bikes.filter(b => !b.retired_at)
  if (ride.isIndoor) {
    const trainer = active.find(b => b.is_indoor_default)
    if (trainer) return trainer.id
  }
  return active.find(b => b.is_default)?.id ?? null
}
