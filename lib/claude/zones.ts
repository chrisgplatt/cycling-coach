// Pure power-zone helpers. Kept dependency-free (no Claude client import) so
// prompt builders and display components can format watt ranges without pulling
// in the Anthropic SDK.
import type { WorkoutStep } from '@/types'

// Power-zone colour ramp (ascending intensity). Boundaries match the zone
// definitions in CLAUDE.md / formatZones below. This is the single source of
// truth for zone labels; WorkoutProfileChart re-exports it for chart use.
export function zoneFor(pct: number): { label: string; fill: string } {
  if (pct < 56) return { label: 'Z1 Recovery', fill: '#94a3b8' }   // slate-400
  if (pct <= 75) return { label: 'Z2 Endurance', fill: '#3b82f6' } // blue-500
  if (pct <= 90) return { label: 'Z3 Tempo', fill: '#22c55e' }     // green-500
  if (pct <= 105) return { label: 'Z4 Threshold', fill: '#eab308' }// yellow-500
  if (pct <= 120) return { label: 'Z5 VO2max', fill: '#f97316' }   // orange-500
  return { label: 'Z6 Anaerobic', fill: '#ef4444' }                // red-500
}

// Derive a live target-zone summary from a workout's structured steps and the
// athlete's CURRENT FTP, e.g. "Z4 Threshold · 250–265W". Because steps store
// percentages (FTP-independent) and the watts are computed here at render time,
// the summary always reflects the latest FTP — unlike the stored target_zones
// string, which bakes in the watts from whenever the plan was generated.
// Returns null when there are no steps or no usable FTP, so callers can fall
// back to the stored string.
export function deriveTargetZones(
  steps: WorkoutStep[] | null | undefined,
  ftp: number | null | undefined,
): string | null {
  if (!steps || steps.length === 0 || !ftp || ftp <= 0) return null
  const headlinePct = Math.max(...steps.map(s => s.power_pct_ftp))
  const zone = zoneFor(headlinePct)
  // Span the watt range across the steps that sit in the headline zone, so an
  // over/under set reads as a band while a steady effort reads as one figure.
  const pcts = steps
    .filter(s => zoneFor(s.power_pct_ftp).label === zone.label)
    .map(s => s.power_pct_ftp)
  const lo = Math.round((ftp * Math.min(...pcts)) / 100)
  const hi = Math.round((ftp * Math.max(...pcts)) / 100)
  return lo === hi ? `${zone.label} · ${lo}W` : `${zone.label} · ${lo}–${hi}W`
}

// FTP-INDEPENDENT version of the zone summary, for STORING in target_zones (and
// the intervals.icu description) so the value never goes stale. Same headline-zone
// logic as deriveTargetZones, but expressed in %FTP, e.g. "Z4 Threshold (91–105% FTP)".
export function deriveTargetZonesPct(steps: WorkoutStep[] | null | undefined): string | null {
  if (!steps || steps.length === 0) return null
  const headlinePct = Math.max(...steps.map(s => s.power_pct_ftp))
  const zone = zoneFor(headlinePct)
  const pcts = steps
    .filter(s => zoneFor(s.power_pct_ftp).label === zone.label)
    .map(s => s.power_pct_ftp)
  const lo = Math.min(...pcts)
  const hi = Math.max(...pcts)
  return lo === hi ? `${zone.label} (${lo}% FTP)` : `${zone.label} (${lo}–${hi}% FTP)`
}

// Remove absolute-watt tokens (e.g. "240–265W", "at 250w", "(140-190W)", "130 watts")
// from a free-text description. Watt numbers baked in at plan-generation time go stale
// when FTP changes; the live step list already shows current watts, so the prose only
// needs its qualitative content. Leaves %FTP, cadence (rpm), durations, and other text
// untouched. Returns the tidied string (unchanged if no watt tokens were present).
export function stripBakedWatts(text: string | null | undefined): string {
  if (!text) return text ?? ''
  const WATTS = '~?\\d{2,4}(?:\\s*[–-]\\s*\\d{2,4})?\\s*[wW](?:atts?)?'
  let out = text
    // " (140-190W)" / "(~250 W)" — a parenthetical that is only a watt figure
    .replace(new RegExp(`\\s*\\(\\s*${WATTS}\\s*\\)`, 'g'), '')
    // " at 240-265W" / " @ 250w" — an "at/@ <watts>" phrase
    .replace(new RegExp(`\\s*(?:\\bat\\b|@)\\s*${WATTS}\\b`, 'gi'), '')
    // leftover standalone watt tokens anywhere else
    .replace(new RegExp(`\\s*\\b${WATTS}\\b`, 'g'), '')
  out = out
    .replace(/\(\s*\)/g, '')       // empty parens left behind
    .replace(/\s+([.,;:])/g, '$1') // space before punctuation
    .replace(/\s{2,}/g, ' ')       // collapsed whitespace
    .trim()
  return out
}

export function formatZones(ftp: number): string {
  const z = (lo: number, hi: number) => `${Math.round(ftp * lo)}–${Math.round(ftp * hi)}W`
  return [
    `  Recovery  (Z1): <${Math.round(ftp * 0.55)}W`,
    `  Endurance (Z2): ${z(0.56, 0.75)}`,
    `  Tempo     (Z3): ${z(0.76, 0.90)}`,
    `  Threshold (Z4): ${z(0.91, 1.05)}`,
    `  VO2max    (Z5): ${z(1.06, 1.20)}`,
    `  Anaerobic (Z6): >${Math.round(ftp * 1.20)}W`,
  ].join('\n')
}
