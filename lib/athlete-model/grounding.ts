// Pure, dependency-free training-data calculations that ground the response model
// in real numbers. No Supabase/Anthropic imports — assembled inputs in, plain
// numbers out, so they are trivially unit-testable and traceable.

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

export interface RampTolerance {
  pct: number
  weeks: number
}

// Weekly TSS in chronological order. Estimate the personal week-over-week ramp the
// athlete absorbed and kept building from (a ramp where the FOLLOWING week did not
// fall back below ~95% of the ramped week). Falls back to the median positive ramp.
export function computeRampTolerance(weeklyTss: number[]): RampTolerance | null {
  if (weeklyTss.length < 4) return null
  const ramps: Array<{ pct: number; sustained: boolean }> = []
  for (let i = 1; i < weeklyTss.length; i++) {
    const prev = weeklyTss[i - 1]
    if (prev <= 0) continue
    const pct = ((weeklyTss[i] - prev) / prev) * 100
    if (pct <= 0) continue
    const sustained = i + 1 < weeklyTss.length && weeklyTss[i + 1] >= weeklyTss[i] * 0.95
    ramps.push({ pct, sustained })
  }
  if (!ramps.length) return null
  const sustained = ramps.filter(r => r.sustained).map(r => r.pct)
  const pool = sustained.length ? sustained : ramps.map(r => r.pct)
  return { pct: Math.round(median(pool)), weeks: weeklyTss.length }
}

// The RPE a session's prescribed intensity would normally warrant (1–10), using the
// CLAUDE.md zone boundaries on %FTP.
export function expectedRpe(targetPct: number): number {
  if (targetPct < 55) return 2
  if (targetPct <= 75) return 4
  if (targetPct <= 90) return 5
  if (targetPct <= 105) return 7
  if (targetPct <= 120) return 8.5
  return 9.5
}

export interface RpeCalibration {
  overall: number
  easyBias: number | null
  hardBias: number | null
  n: number
}

const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length
const round1 = (x: number): number => Math.round(x * 10) / 10

export function computeRpeCalibration(
  sessions: Array<{ rpe: number; targetPct: number }>,
): RpeCalibration | null {
  const rated = sessions.filter(s => Number.isFinite(s.rpe) && Number.isFinite(s.targetPct))
  if (rated.length < 5) return null
  const diff = (s: { rpe: number; targetPct: number }) => s.rpe - expectedRpe(s.targetPct)
  const easy = rated.filter(s => s.targetPct <= 75)
  const hard = rated.filter(s => s.targetPct >= 91)
  return {
    overall: round1(mean(rated.map(diff))),
    easyBias: easy.length >= 3 ? round1(mean(easy.map(diff))) : null,
    hardBias: hard.length >= 3 ? round1(mean(hard.map(diff))) : null,
    n: rated.length,
  }
}
