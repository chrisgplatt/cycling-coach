import type { BeliefConfidence } from '@/types'
import { computeRampTolerance, computeRpeCalibration, computeRecoveryProfile, computeCoachingResonance } from './grounding'

// A belief the synthesis proposes this run, before reconciliation against stored state.
export interface CandidateBelief {
  key: string
  label: string
  value_text: string
  value_data: Record<string, unknown>
  confidence: BeliefConfidence
  evidence: string
  source: 'computed'
}

export function confidenceFromCount(n: number, medMin: number, highMin: number): BeliefConfidence {
  if (n >= highMin) return 'high'
  if (n >= medMin) return 'medium'
  return 'low'
}

export interface GroundingInputs {
  weeklyTss: number[]
  rpeSessions: Array<{ rpe: number; targetPct: number }>
  recovery: Array<{ date: string; isHard: boolean; completedWell: boolean; feel: number | null }>
  coachingRatings?: Array<'helpful' | 'not_helpful'>
}

// Suppress RPE biases smaller than this (points) as noise rather than signal.
const MIN_RPE_BIAS = 0.5

const feelWord = (f: number): string => (f <= 2 ? 'fresh' : f <= 3 ? 'okay' : 'flat')

export function buildGroundedBeliefs(inputs: GroundingInputs): CandidateBelief[] {
  const out: CandidateBelief[] = []

  const ramp = computeRampTolerance(inputs.weeklyTss)
  if (ramp) {
    const where = ramp.pct < 8 ? 'below' : ramp.pct > 11 ? 'above' : 'around'
    out.push({
      key: 'ramp_tolerance',
      label: 'Weekly ramp tolerance',
      value_text: `Has sustained roughly +${ramp.pct}% TSS week-over-week in build periods — ${where} the textbook 10%.`,
      value_data: { pct: ramp.pct, weeks: ramp.weeks },
      confidence: confidenceFromCount(ramp.weeks, 6, 10),
      evidence: `${ramp.weeks} weeks of load history`,
      source: 'computed',
    })
  }

  const rpe = computeRpeCalibration(inputs.rpeSessions)
  if (rpe) {
    const parts: string[] = []
    if (rpe.easyBias != null && Math.abs(rpe.easyBias) >= MIN_RPE_BIAS) {
      parts.push(`${rpe.easyBias > 0 ? 'over' : 'under'}-rates easy rides by ~${Math.abs(rpe.easyBias)}`)
    }
    if (rpe.hardBias != null && Math.abs(rpe.hardBias) >= MIN_RPE_BIAS) {
      parts.push(`${rpe.hardBias > 0 ? 'over' : 'under'}-rates hard efforts by ~${Math.abs(rpe.hardBias)}`)
    }
    const body = parts.length
      ? `Perceived effort ${parts.join('; ')} (RPE points).`
      : `Perceived effort tracks prescribed intensity closely (overall bias ${rpe.overall}).`
    out.push({
      key: 'rpe_calibration',
      label: 'RPE calibration',
      value_text: body,
      value_data: { overall: rpe.overall, easyBias: rpe.easyBias, hardBias: rpe.hardBias, n: rpe.n },
      confidence: confidenceFromCount(rpe.n, 8, 12),
      evidence: `${rpe.n} rated sessions`,
      source: 'computed',
    })
  }

  const rec = computeRecoveryProfile(inputs.recovery)
  if (rec) {
    const feelClause = rec.nextDayAvgFeel != null
      ? `, typically feeling ${feelWord(rec.nextDayAvgFeel)} (${rec.nextDayAvgFeel}/5)`
      : ''
    out.push({
      key: 'recovery',
      label: 'Recovery profile',
      value_text: `Completes ${rec.nextDayCompletionRate}% of sessions the day after a hard day${feelClause}.`,
      value_data: { nextDayCompletionRate: rec.nextDayCompletionRate, nextDayAvgFeel: rec.nextDayAvgFeel, n: rec.n },
      confidence: confidenceFromCount(rec.n, 4, 8),
      evidence: `${rec.n} post-hard days`,
      source: 'computed',
    })
  }

  const resonance = computeCoachingResonance(inputs.coachingRatings ?? [])
  if (resonance) {
    const landing = resonance.pct >= 70 ? 'landing well'
      : resonance.pct >= 40 ? 'landing unevenly'
      : 'often missing the mark'
    out.push({
      key: 'coaching_resonance',
      label: 'Coaching resonance',
      value_text: `Marked ${resonance.helpful}/${resonance.total} post-ride coach notes helpful — feedback is ${landing}.`,
      value_data: { helpful: resonance.helpful, total: resonance.total, pct: resonance.pct },
      confidence: confidenceFromCount(resonance.total, 5, 10),
      evidence: `${resonance.total} rated coach notes`,
      source: 'computed',
    })
  }

  return out
}
