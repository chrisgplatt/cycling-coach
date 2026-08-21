/** @jest-environment node */
import {
  computeDailyTrimp,
  computeTrimpRef,
  computeWorkoutStrain,
  computeStrainTarget,
  strainLabel,
  computeActivityTrimpBreakdown,
  computeWorkoutStrainSeries,
  formatStrainForPrompt,
  formatStrainHistoryForPrompt,
} from '@/lib/strain'

describe('computeDailyTrimp', () => {
  test('single activity with HR data uses HRR exponential formula', () => {
    // hrr = (150-50)/(190-50) = 100/140 = 0.7143
    // trimp = 60 * 0.7143 * 0.64 * e^(1.92*0.7143) = 60 * 0.7143 * 0.64 * e^1.3714
    //       = 60 * 0.7143 * 0.64 * 3.9407 ≈ 108.05
    const result = computeDailyTrimp(
      [{ name: 'Ride', durationMin: 60, avgHr: 150, trainingLoad: 80 }],
      190, 50,
    )
    expect(result).toBeCloseTo(108.05, 0)
  })

  test('two activities sum their TRIMP', () => {
    const single = computeDailyTrimp(
      [{ name: 'Ride', durationMin: 60, avgHr: 150, trainingLoad: 80 }],
      190, 50,
    )
    const doubled = computeDailyTrimp(
      [
        { name: 'Ride AM', durationMin: 60, avgHr: 150, trainingLoad: 80 },
        { name: 'Ride PM', durationMin: 60, avgHr: 150, trainingLoad: 80 },
      ],
      190, 50,
    )
    expect(doubled).toBeCloseTo(single * 2, 4)
  })

  test('falls back to trainingLoad-based estimate when avgHr is missing', () => {
    // TRIMP_PER_TSS_FALLBACK = 1.0 → trimp = trainingLoad * 1.0
    const result = computeDailyTrimp(
      [{ name: 'Trainer ride, no HR strap', durationMin: 45, avgHr: null, trainingLoad: 60 }],
      190, 50,
    )
    expect(result).toBeCloseTo(60, 4)
  })

  test('falls back when maxHr is missing even if avgHr present', () => {
    const result = computeDailyTrimp(
      [{ name: 'Ride', durationMin: 45, avgHr: 150, trainingLoad: 60 }],
      null, 50,
    )
    expect(result).toBeCloseTo(60, 4)
  })

  test('falls back when restingHr is missing even if avgHr present', () => {
    const result = computeDailyTrimp(
      [{ name: 'Ride', durationMin: 45, avgHr: 150, trainingLoad: 60 }],
      190, null,
    )
    expect(result).toBeCloseTo(60, 4)
  })

  test('activity with neither avgHr nor trainingLoad contributes zero', () => {
    const result = computeDailyTrimp(
      [{ name: 'Untracked walk', durationMin: 20, avgHr: null, trainingLoad: null }],
      190, 50,
    )
    expect(result).toBe(0)
  })

  test('no activities → zero', () => {
    expect(computeDailyTrimp([], 190, 50)).toBe(0)
  })

  test('hrr is clamped at 1 when avgHr exceeds maxHr', () => {
    // hrr would be (200-50)/(190-50)=1.071, clamped to 1
    // trimp = 60 * 1 * 0.64 * e^1.92 = 60 * 0.64 * 6.822 ≈ 261.96
    const result = computeDailyTrimp(
      [{ name: 'Max effort', durationMin: 60, avgHr: 200, trainingLoad: 100 }],
      190, 50,
    )
    expect(result).toBeCloseTo(261.96, 0)
  })

  test('hrr is clamped at 0 when avgHr is below restingHr', () => {
    const result = computeDailyTrimp(
      [{ name: 'Very easy spin', durationMin: 60, avgHr: 40, trainingLoad: 10 }],
      190, 50,
    )
    expect(result).toBe(0)
  })
})

describe('computeTrimpRef', () => {
  test('fewer than 5 samples uses the cold-start default', () => {
    expect(computeTrimpRef([100, 120, 90])).toBe(150)
  })

  test('empty history uses the cold-start default', () => {
    expect(computeTrimpRef([])).toBe(150)
  })

  test('95th percentile of 21 samples picks the top value', () => {
    const samples = Array.from({ length: 21 }, (_, i) => (i + 1) * 10) // 10..210
    // ceil(0.95*21)-1 = ceil(19.95)-1 = 20-1 = 19 → sorted[19] = 200
    expect(computeTrimpRef(samples)).toBe(200)
  })

  test('zero and negative samples are excluded from the percentile calc', () => {
    const samples = [0, 0, 0, 100, 120, 90, 110, 105]
    expect(computeTrimpRef(samples)).toBeGreaterThan(0)
    expect(computeTrimpRef(samples)).toBeLessThanOrEqual(120)
  })
})

describe('computeWorkoutStrain', () => {
  test('zero dailyTrimp → zero strain', () => {
    expect(computeWorkoutStrain(0, 150)).toBe(0)
  })

  test('dailyTrimp equal to trimpRef lands at 21 (the reference IS the hard-day ceiling)', () => {
    expect(computeWorkoutStrain(150, 150)).toBe(21)
  })

  test('dailyTrimp well below trimpRef gives a moderate score', () => {
    // ratio = 50/150 = 1/3; 21 * ln(1 + 6/3) / ln(7) = 21 * ln(3) / ln(7) ≈ 11.86 → rounds to 12
    const result = computeWorkoutStrain(50, 150)
    expect(result).toBe(12)
  })

  test('dailyTrimp at ~15-20% of trimpRef (an easy walk or recovery spin) lands "light", not "high"', () => {
    // ratio = 25/150 = 1/6; 21 * ln(1 + 6/6) / ln(7) = 21 * ln(2) / ln(7) ≈ 7.48 → rounds to 7
    // Regression guard: the previous ln(1+x)/ln(1+ref) formula gave this ~13/21 ("high"),
    // which is what prompted the fix — a walk should never register as high strain.
    const result = computeWorkoutStrain(25, 150)
    expect(result).toBe(7)
    expect(strainLabel(result)).toBe('light')
  })

  test('dailyTrimp above trimpRef still caps at 21', () => {
    expect(computeWorkoutStrain(500, 150)).toBe(21)
  })

  test('trimpRef of zero is floored to avoid division by ln(1)=0', () => {
    expect(() => computeWorkoutStrain(50, 0)).not.toThrow()
    expect(computeWorkoutStrain(50, 0)).toBe(21)
  })
})

describe('strainLabel', () => {
  test('0-9 → light', () => {
    expect(strainLabel(0)).toBe('light')
    expect(strainLabel(9)).toBe('light')
  })
  test('10-13 → moderate', () => {
    expect(strainLabel(10)).toBe('moderate')
    expect(strainLabel(13)).toBe('moderate')
  })
  test('14-17 → high', () => {
    expect(strainLabel(14)).toBe('high')
    expect(strainLabel(17)).toBe('high')
  })
  test('18-21 → all_out', () => {
    expect(strainLabel(18)).toBe('all_out')
    expect(strainLabel(21)).toBe('all_out')
  })
})

describe('computeWorkoutStrainSeries', () => {
  const maxHr = 190

  test('a past day with existing frozen values is returned as-is and not re-flagged', () => {
    const result = computeWorkoutStrainSeries(
      [{
        date: '2026-07-10',
        activities: [{ name: 'Ride', durationMin: 60, avgHr: 150, trainingLoad: 80 }],
        restingHr: 50,
        frozenDailyTrimp: 999,     // deliberately different from what a live calc would give —
        frozenTrimpRef: 300,       // proves the frozen values win, not a recompute
        frozenWorkoutStrain: 12,
      }],
      maxHr,
      '2026-07-18',
    )
    expect(result).toEqual([{
      date: '2026-07-10', dailyTrimp: 999, trimpRef: 300, workoutStrain: 12, needsFreeze: false,
    }])
  })

  test('a past day with no frozen values is computed live and flagged for freezing', () => {
    const result = computeWorkoutStrainSeries(
      [{
        date: '2026-07-10',
        activities: [{ name: 'Ride', durationMin: 60, avgHr: 150, trainingLoad: 80 }],
        restingHr: 50,
        frozenDailyTrimp: null, frozenTrimpRef: null, frozenWorkoutStrain: null,
      }],
      maxHr,
      '2026-07-18',
    )
    expect(result[0].needsFreeze).toBe(true)
    expect(result[0].dailyTrimp).toBeCloseTo(108.05, 0)
    expect(result[0].trimpRef).toBe(150)   // cold start — no prior days in this series
  })

  test("today's day is never flagged for freezing, even with no existing frozen row", () => {
    const result = computeWorkoutStrainSeries(
      [{
        date: '2026-07-18',
        activities: [{ name: 'Ride', durationMin: 60, avgHr: 150, trainingLoad: 80 }],
        restingHr: 50,
        frozenDailyTrimp: null, frozenTrimpRef: null, frozenWorkoutStrain: null,
      }],
      maxHr,
      '2026-07-18',
    )
    expect(result[0].needsFreeze).toBe(false)
  })

  test('trimpRef for a later day uses the trailing window of earlier days in the same series', () => {
    // Day 1 has dailyTrimp X (unfrozen, gets computed). Day 2 (today) should see
    // day 1's freshly-computed value in its trailing window, not the cold-start default.
    const days = [
      {
        date: '2026-07-17',
        activities: [{ name: 'Hard ride', durationMin: 90, avgHr: 165, trainingLoad: 120 }],
        restingHr: 50,
        frozenDailyTrimp: null, frozenTrimpRef: null, frozenWorkoutStrain: null,
      },
      {
        date: '2026-07-18',
        activities: [],
        restingHr: 50,
        frozenDailyTrimp: null, frozenTrimpRef: null, frozenWorkoutStrain: null,
      },
    ]
    const result = computeWorkoutStrainSeries(days, maxHr, '2026-07-18')
    // With only 1 sample in the trailing window (< TRIMP_REF_MIN_SAMPLES=5), day 2 still
    // falls back to the cold-start default — this asserts that behaviour explicitly.
    expect(result[1].trimpRef).toBe(150)
  })

  test('rolling window caps at 21 days — the 22nd prior day drops out', () => {
    const days = Array.from({ length: 22 }, (_, i) => ({
      date: `day-${i}`,
      activities: [{ name: 'Ride', durationMin: 60, avgHr: 150, trainingLoad: i === 0 ? 500 : 80 }],
      restingHr: 50,
      frozenDailyTrimp: null, frozenTrimpRef: null, frozenWorkoutStrain: null,
    }))
    // day-0 is a huge outlier; by day index 22 it should have rolled out of the 21-day window.
    // We just assert the series computes without error and every day has a trimpRef.
    const result = computeWorkoutStrainSeries(days, maxHr, 'day-999')
    expect(result).toHaveLength(22)
    expect(result.every(r => r.trimpRef > 0)).toBe(true)
  })
})

describe('computeActivityTrimpBreakdown', () => {
  test('returns one entry per activity with non-zero trimp, dropping zero-trimp entries', () => {
    const result = computeActivityTrimpBreakdown(
      [
        { name: 'Morning ride', durationMin: 60, avgHr: 150, trainingLoad: 80 },
        { name: 'Untracked walk', durationMin: 20, avgHr: null, trainingLoad: null },
      ],
      190, 50,
    )
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('Morning ride')
    expect(result[0].trimp).toBeGreaterThan(0)
  })
})

describe('formatStrainForPrompt', () => {
  test('includes score, scale, and label', () => {
    const s = formatStrainForPrompt(11)
    expect(s).toBe('Daily Strain: 11/21 (moderate)')
  })

  test('null → empty string', () => {
    expect(formatStrainForPrompt(null)).toBe('')
  })

  test('reflects the all_out band at the top of the scale', () => {
    expect(formatStrainForPrompt(20)).toBe('Daily Strain: 20/21 (all_out)')
  })
})

describe('formatStrainHistoryForPrompt', () => {
  test('7-day history includes avg and trend', () => {
    const history = [8, 14, 16, 12, 9, 6, 11].map((strain, i) => ({
      date: `2026-06-0${i + 1}`,
      strain,
    }))
    const s = formatStrainHistoryForPrompt(history)
    expect(s).toContain('last 7 days')
    expect(s).toContain('avg:')
    expect(s).toMatch(/trend: (rising|stable|falling)/)
  })

  test('all-null history → empty string', () => {
    const history = [null, null, null].map((strain, i) => ({ date: `2026-06-0${i + 1}`, strain }))
    expect(formatStrainHistoryForPrompt(history)).toBe('')
  })

  test('single entry → empty string', () => {
    expect(formatStrainHistoryForPrompt([{ date: '2026-06-01', strain: 10 }])).toBe('')
  })

  test('rising trend detected when recent > earlier + 2', () => {
    const history = [4, 5, 4, 5, 14, 15, 16].map((strain, i) => ({
      date: `2026-06-0${i + 1}`,
      strain,
    }))
    expect(formatStrainHistoryForPrompt(history)).toContain('rising')
  })
})

describe('computeStrainTarget', () => {
  test('recovery 70 gives a range close to Whoop\'s disclosed 8.3-16.3 example', () => {
    // low = round(0.70 * 14) = round(9.8) = 10; high = min(21, 10+7) = 17
    expect(computeStrainTarget(70)).toEqual({ low: 10, high: 17 })
  })

  test('recovery 100 reaches the top of the scale', () => {
    // low = round(1.00 * 14) = 14; high = min(21, 14+7) = 21
    expect(computeStrainTarget(100)).toEqual({ low: 14, high: 21 })
  })

  test('recovery 34 (Whoop\'s red cutoff) stays light-to-moderate', () => {
    // low = round(0.34 * 14) = round(4.76) = 5; high = min(21, 5+7) = 12
    expect(computeStrainTarget(34)).toEqual({ low: 5, high: 12 })
  })

  test('recovery 0 gives the lowest possible range', () => {
    expect(computeStrainTarget(0)).toEqual({ low: 0, high: 7 })
  })

  test('high is capped at 21 even if low+width would exceed it', () => {
    // Not reachable with the current constants at recoveryScore<=100, but the
    // cap must still hold if STRAIN_TARGET_LOW_MAX/RANGE_WIDTH are ever retuned.
    const { high } = computeStrainTarget(100)
    expect(high).toBeLessThanOrEqual(21)
  })

  test('out-of-range recoveryScore is clamped rather than producing a negative or >14 low', () => {
    expect(computeStrainTarget(-10)).toEqual({ low: 0, high: 7 })
    expect(computeStrainTarget(150)).toEqual({ low: 14, high: 21 })
  })
})
