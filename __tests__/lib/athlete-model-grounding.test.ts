import { computeRampTolerance, computeRpeCalibration, expectedRpe, computeRecoveryProfile } from '@/lib/athlete-model/grounding'

describe('computeRampTolerance', () => {
  it('returns null below four weeks of data', () => {
    expect(computeRampTolerance([300, 320, 340])).toBeNull()
  })

  it('estimates the sustained week-over-week ramp the athlete kept building from', () => {
    // +10%, +10% (both held the following week), then a ramp that BACKED OFF.
    // Sustained ramps are the two +10%s → median 10.
    const out = computeRampTolerance([300, 330, 363, 399, 300])!
    expect(out.pct).toBe(10)
    expect(out.weeks).toBe(5)
  })

  it('falls back to the median positive ramp when none were sustained', () => {
    // Every ramp is followed by a drop → no sustained ramps; median of +20,+25 ≈ 23.
    const out = computeRampTolerance([200, 240, 200, 250, 200])!
    expect(out.pct).toBe(23)
  })

  it('treats a zero week as a baseline gap (does not ramp from it)', () => {
    const out = computeRampTolerance([0, 300, 330, 363])!
    expect(out.pct).toBe(10)
  })

  it('returns null when weekly TSS is flat (no positive ramps)', () => {
    expect(computeRampTolerance([300, 300, 300, 300])).toBeNull()
  })
})

describe('expectedRpe', () => {
  it('maps prescribed %FTP to a normal RPE', () => {
    expect(expectedRpe(50)).toBe(2)
    expect(expectedRpe(70)).toBe(4)
    expect(expectedRpe(85)).toBe(5)
    expect(expectedRpe(100)).toBe(7)
    expect(expectedRpe(115)).toBe(8.5)
    expect(expectedRpe(130)).toBe(9.5)
  })
})

describe('computeRpeCalibration', () => {
  it('returns null below five rated sessions', () => {
    const s = [
      { rpe: 7, targetPct: 100 }, { rpe: 7, targetPct: 100 },
      { rpe: 7, targetPct: 100 }, { rpe: 7, targetPct: 100 },
    ]
    expect(computeRpeCalibration(s)).toBeNull()
  })

  it('reports an overall bias and splits easy vs hard when each has enough', () => {
    const s = [
      { rpe: 5, targetPct: 70 }, { rpe: 5, targetPct: 70 }, { rpe: 5, targetPct: 70 },
      { rpe: 6, targetPct: 100 }, { rpe: 6, targetPct: 100 }, { rpe: 6, targetPct: 100 },
    ]
    const out = computeRpeCalibration(s)!
    expect(out.n).toBe(6)
    expect(out.easyBias).toBe(1)
    expect(out.hardBias).toBe(-1)
    expect(out.overall).toBe(0)
  })

  it('omits a split with fewer than three sessions', () => {
    const s = [
      { rpe: 5, targetPct: 70 }, { rpe: 5, targetPct: 70 }, { rpe: 5, targetPct: 70 },
      { rpe: 5, targetPct: 70 }, { rpe: 6, targetPct: 100 },
    ]
    const out = computeRpeCalibration(s)!
    expect(out.easyBias).toBe(1)
    expect(out.hardBias).toBeNull()
  })
})

describe('computeRecoveryProfile', () => {
  const day = (n: number) => `2026-05-${String(n).padStart(2, '0')}`

  it('returns null with fewer than three post-hard days', () => {
    const sessions = [
      { date: day(1), isHard: true, completedWell: true, feel: 2 },
      { date: day(2), isHard: false, completedWell: true, feel: 2 },
    ]
    expect(computeRecoveryProfile(sessions)).toBeNull()
  })

  it('measures completion and feel on days immediately after a hard day', () => {
    const sessions = [
      { date: day(1), isHard: true, completedWell: true, feel: 3 },
      { date: day(2), isHard: false, completedWell: true, feel: 2 },
      { date: day(3), isHard: true, completedWell: true, feel: 3 },
      { date: day(4), isHard: false, completedWell: false, feel: 4 },
      { date: day(5), isHard: true, completedWell: true, feel: 3 },
      { date: day(6), isHard: false, completedWell: true, feel: 3 },
    ]
    const out = computeRecoveryProfile(sessions)!
    expect(out.n).toBe(3)
    expect(out.nextDayCompletionRate).toBe(67)
    expect(out.nextDayAvgFeel).toBe(3)
  })

  it('only counts the immediately-following calendar day', () => {
    const sessions = [
      { date: day(1), isHard: true, completedWell: true, feel: 3 },
      { date: day(3), isHard: false, completedWell: true, feel: 2 },
      { date: day(10), isHard: true, completedWell: true, feel: 3 },
      { date: day(11), isHard: false, completedWell: false, feel: 4 },
      { date: day(12), isHard: true, completedWell: true, feel: 3 },
      { date: day(13), isHard: false, completedWell: true, feel: 2 },
      { date: day(20), isHard: true, completedWell: true, feel: 3 },
      { date: day(21), isHard: false, completedWell: true, feel: 2 },
    ]
    const out = computeRecoveryProfile(sessions)!
    expect(out.n).toBe(3)
  })

  it('reports null average feel when no post-hard day has a feel', () => {
    const sessions = [
      { date: day(1), isHard: true, completedWell: true, feel: null },
      { date: day(2), isHard: false, completedWell: true, feel: null },
      { date: day(3), isHard: true, completedWell: true, feel: null },
      { date: day(4), isHard: false, completedWell: false, feel: null },
      { date: day(5), isHard: true, completedWell: true, feel: null },
      { date: day(6), isHard: false, completedWell: true, feel: null },
    ]
    const out = computeRecoveryProfile(sessions)!
    expect(out.n).toBe(3)
    expect(out.nextDayAvgFeel).toBeNull()
    expect(out.nextDayCompletionRate).toBe(67)
  })
})
