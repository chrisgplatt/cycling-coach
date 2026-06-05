import type { AthleteBelief, BeliefConfidence } from '@/types'
import type { CandidateBelief } from './build-beliefs'

// A row to upsert (onConflict user_id,key). user_id is added by the orchestrator.
export type BeliefUpsert = Partial<AthleteBelief> & { key: string }

const RANK: Record<BeliefConfidence, number> = { low: 1, medium: 2, high: 3 }
const BY_RANK: BeliefConfidence[] = ['low', 'low', 'medium', 'high'] // index by rank (1..3)
const stepUp = (c: BeliefConfidence): BeliefConfidence => BY_RANK[Math.min(3, RANK[c] + 1)]
const stepDown = (c: BeliefConfidence, floor: BeliefConfidence): BeliefConfidence =>
  BY_RANK[Math.max(RANK[floor], RANK[c] - 1)]
const higher = (a: BeliefConfidence, b: BeliefConfidence): BeliefConfidence => (RANK[a] >= RANK[b] ? a : b)

const STALE_DAYS = 42 // ~6 weeks
function daysBetween(fromIso: string, toIso: string): number {
  return (new Date(toIso).getTime() - new Date(fromIso).getTime()) / 864e5
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

// Whether stored and candidate value_data describe the same thing, within a per-key
// tolerance on the headline number. Missing data on either side → not agreeing.
function beliefsAgree(key: string, a: Record<string, unknown> | null, b: Record<string, unknown>): boolean {
  if (!a) return false
  if (key === 'ramp_tolerance') return Math.abs(num(a.pct) - num(b.pct)) <= 3
  if (key === 'rpe_calibration') return Math.abs(num(a.overall) - num(b.overall)) <= 0.5
  if (key === 'recovery') return Math.abs(num(a.nextDayCompletionRate) - num(b.nextDayCompletionRate)) <= 15
  return JSON.stringify(a) === JSON.stringify(b)
}

export function reconcileBeliefs(
  existing: AthleteBelief[],
  candidates: CandidateBelief[],
  now: string,
): BeliefUpsert[] {
  const byKey = new Map(existing.map(b => [b.key, b]))
  const candidateKeys = new Set(candidates.map(c => c.key))
  const out: BeliefUpsert[] = []

  for (const cand of candidates) {
    const ex = byKey.get(cand.key)

    if (!ex) {
      out.push({
        key: cand.key, label: cand.label, value_text: cand.value_text, value_data: cand.value_data,
        confidence: cand.confidence, evidence: cand.evidence, source: cand.source, status: 'active',
        first_observed: now, last_updated: now, last_confirmed: now, revisions: [], contradiction: null,
      })
      continue
    }

    if (ex.status === 'dismissed') continue // athlete vetoed — never resurrect from synthesis

    if (ex.status === 'confirmed' || ex.status === 'corrected') {
      // Athlete ground truth — never overwrite the value.
      if (beliefsAgree(cand.key, ex.value_data, cand.value_data)) {
        out.push({ ...ex, last_confirmed: now, last_updated: now, contradiction: null })
      } else {
        out.push({ ...ex, last_updated: now, contradiction: { observed: cand.value_text, noted_at: now } })
      }
      continue
    }

    // Active AI/computed belief.
    if (ex.value_data == null || beliefsAgree(cand.key, ex.value_data, cand.value_data)) {
      // Consistent (or no prior data to compare against) → update value, reaffirm,
      // nudge confidence. Using stepUp(cand) — not stepUp(ex) — means a low-data
      // re-observation can't vault a belief to high; confidence stays bounded by the
      // evidence supporting it, while never dropping below the stored level.
      out.push({
        ...ex, value_text: cand.value_text, value_data: cand.value_data, evidence: cand.evidence,
        confidence: higher(ex.confidence, stepUp(cand.confidence)),
        last_updated: now, last_confirmed: now, contradiction: null,
      })
    } else {
      out.push({
        ...ex, value_text: cand.value_text, value_data: cand.value_data, evidence: cand.evidence,
        confidence: cand.confidence, last_updated: now, last_confirmed: now, contradiction: null,
        revisions: [
          ...ex.revisions,
          { value_text: ex.value_text, confidence: ex.confidence, evidence: ex.evidence, revised_at: now, reason: 'new evidence contradicted the prior value' },
        ].slice(-20),
      })
    }
  }

  // Decay stale beliefs that got no fresh candidate this run.
  for (const ex of existing) {
    if (candidateKeys.has(ex.key)) continue
    if (ex.status === 'dismissed' || ex.status === 'superseded') continue
    const last = ex.last_confirmed ?? ex.first_observed
    if (daysBetween(last, now) <= STALE_DAYS) continue
    const isAthlete = ex.status === 'confirmed' || ex.status === 'corrected'
    const decayed = stepDown(ex.confidence, isAthlete ? 'medium' : 'low')
    if (decayed === ex.confidence) continue // already at floor
    out.push({ ...ex, confidence: decayed, last_updated: now })
  }

  return out
}
