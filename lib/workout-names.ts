import type { WorkoutType, WorkoutStep } from '@/types'

// Curated, cycling-flavoured names — a mix of famous climbs and cycling vocabulary,
// kept short so "{Name} - {duration}" stays legible on a Garmin Edge's small display.
export const SESSION_NAMES = [
  // Climbs
  'Sa Batalla', "Alpe d'Huez", 'Angliru', 'Stelvio', 'Mortirolo', 'Ventoux',
  'Tourmalet', 'Zoncolan', 'Galibier', 'Umbrail Pass', 'Grimsel', 'Gavia',
  'Kitzbüheler Horn', 'Madone', "Ballon d'Alsace", 'Col de la Loze',
  'Peyresourde', 'Aubisque', 'Izoard', 'Colle delle Finestre', 'Grossglockner',
  'Passo Fedaia', 'Sestriere', 'Puy de Dôme', 'Cipressa', 'Poggio',
  'Muur van Geraardsbergen', 'Koppenberg', 'Paterberg', 'Kemmelberg',
  // Cycling vocabulary
  'Domestique', 'Rouleur', 'Puncheur', 'Flamme Rouge', 'Grupetto',
  'Echappée', 'Peloton', 'Breakaway', 'Bidon', 'Attaque', 'Autobus',
  'Musette', 'Soigneur', 'Directeur Sportif', 'Lanterne Rouge', 'Bonk',
  'Sprint Royal', 'Feed Zone', 'Chasse Patate', 'Hors Catégorie',
  'Repechage', 'Sur la Jante', 'Danseuse', 'Souplesse',
] as const

function round5(n: number): number {
  return Math.round(n / 5) * 5
}

// Builds a stable key for "the same session shape" — type, overall duration, and each
// step's (duration, intensity), all rounded to the nearest 5 to absorb trivial AI
// generation jitter (e.g. 91% vs 90% FTP for what's really the same effort). Step
// `label` text and `cadence` are deliberately excluded — cosmetic, not part of the shape.
export function workoutFingerprint(type: WorkoutType, durationMinutes: number, steps: WorkoutStep[]): string {
  const stepsPart = steps.map(s => `${round5(s.duration_minutes)}:${round5(s.power_pct_ftp)}`).join(',')
  return `${type}|${round5(durationMinutes)}|${stepsPart}`
}

// Deterministic string hash (FNV-1a). Same input always produces the same output.
export function hashString(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

// Picks a name deterministically from the fingerprint: same session shape always
// produces the same name. Different fingerprints occasionally landing on the same
// list entry (a hash collision) is an accepted trade-off — the guarantee is "same
// session -> same name," not "different session -> guaranteed-different name."
export function nameForWorkout(type: WorkoutType, durationMinutes: number, steps: WorkoutStep[]): string {
  const fingerprint = workoutFingerprint(type, durationMinutes, steps)
  const entry = SESSION_NAMES[hashString(fingerprint) % SESSION_NAMES.length]
  return `${entry} - ${round5(durationMinutes)}`
}
