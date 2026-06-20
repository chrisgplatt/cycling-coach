/** @jest-environment node */
import {
  computeDailyStrain,
  computeDailyLifeLoad,
  computeStrainComponents,
  strainLabel,
  formatStrainForPrompt,
  formatStrainHistoryForPrompt,
} from '@/lib/strain'

describe('computeDailyLifeLoad', () => {
  test('poor sleep only', () => {
    // sleep_score=30 → ((100-30)/100)*2=1.4, avail=2 → (1.4/2)*7=4.9
    expect(computeDailyLifeLoad(30, null)).toBeCloseTo(4.9, 1)
  })

  test('low body battery only', () => {
    // body_battery_high=20 → ((100-20)/100)*1.5=1.2, avail=1.5 → (1.2/1.5)*7=5.6
    expect(computeDailyLifeLoad(null, 20)).toBeCloseTo(5.6, 1)
  })

  test('both signals present', () => {
    // sleep=85→0.3, battery=75→0.375; raw=0.675, avail=3.5 → (0.675/3.5)*7=1.35
    expect(computeDailyLifeLoad(85, 75)).toBeCloseTo(1.35, 1)
  })

  test('great sleep + good battery gives low score', () => {
    // sleep=90→0.2, battery=85→0.225; raw=0.425, avail=3.5 → (0.425/3.5)*7=0.85
    expect(computeDailyLifeLoad(90, 85)).toBeCloseTo(0.85, 1)
  })

  test('all null → null', () => {
    expect(computeDailyLifeLoad(null, null)).toBeNull()
  })

  test('7.5h sleep duration gives zero penalty', () => {
    // 27000s = target, durationScore=100 → ((100-100)/100)*1=0, adds nothing
    expect(computeDailyLifeLoad(null, null, 27000)).toBeCloseTo(0, 4)
  })

  test('5h sleep duration gives max penalty', () => {
    // 18000s = floor, durationScore=0 → ((100-0)/100)*1=1, avail=1 → (1/1)*7=7
    expect(computeDailyLifeLoad(null, null, 18000)).toBeCloseTo(7, 4)
  })

  test('6h sleep (midpoint) gives partial penalty', () => {
    // 21600s: score = (21600-18000)/(27000-18000)*100 = 3600/9000*100 ≈ 40
    // raw = (60/100)*1 = 0.6, avail=1 → (0.6/1)*7 = 4.2
    expect(computeDailyLifeLoad(null, null, 21600)).toBeCloseTo(4.2, 1)
  })

})

describe('computeStrainComponents', () => {
  test('returns null when all inputs null', () => {
    expect(computeStrainComponents(null, null, null)).toBeNull()
  })

  test('workoutPts = (load / 150) * 14', () => {
    const c = computeStrainComponents(75, null, null)
    expect(c).not.toBeNull()
    expect(c!.workoutPts).toBeCloseTo(7, 1)   // (75/150)*14 = 7
    expect(c!.workoutLoad).toBe(75)
  })

  test('lifePts matches computeDailyLifeLoad', () => {
    const c = computeStrainComponents(0, 85, 75)!
    const expected = computeDailyLifeLoad(85, 75)!
    expect(c.lifePts).toBeCloseTo(expected, 4)
  })

  test('raw sub-scores are un-normalised', () => {
    // battery=20 only: raw = (80/100)*1.5 = 1.2; normalised life = 5.6
    // batteryRawPts should be 1.2, not 5.6
    const c = computeStrainComponents(0, null, 20)!
    expect(c.sleepRawPts).toBe(0)
    expect(c.batteryRawPts).toBeCloseTo(1.2, 1)
  })

  test('sleepDurationRawPts for 6h sleep', () => {
    // 21600s: durationScore ≈ 40 → (60/100)*1 = 0.6
    const c = computeStrainComponents(0, null, null, 21600)!
    expect(c.sleepDurationRawPts).toBeCloseTo(0.6, 1)
    expect(c.sleepRawPts).toBe(0)
    expect(c.batteryRawPts).toBe(0)
  })

  test('sleepDurationRawPts is 0 at 7.5h target', () => {
    const c = computeStrainComponents(0, null, null, 27000)!
    expect(c.sleepDurationRawPts).toBeCloseTo(0, 4)
  })

  test('source values pass through unchanged', () => {
    const c = computeStrainComponents(100, 72, 35, 25200)!
    expect(c.sleepScore).toBe(72)
    expect(c.bodyBatteryHigh).toBe(35)
    expect(c.sleepSecs).toBe(25200)
  })

  test('no workout today — workoutPts is 0', () => {
    const c = computeStrainComponents(0, 85, null)!
    expect(c.workoutPts).toBe(0)
    expect(c.workoutLoad).toBe(0)
  })

  test('total matches Math.min(21, Math.round(workoutPts + lifePts))', () => {
    // load=75 → workoutPts=7; sleep=85,battery=75 → lifePts≈1.35
    // total = round(7 + 1.35) = round(8.35) = 8
    const c = computeStrainComponents(75, 85, 75)!
    expect(c.total).toBe(Math.min(21, Math.round(c.workoutPts + c.lifePts)))
  })

  test('total caps at 21', () => {
    // workoutPts=14 (capped), sleep=0 battery=0 → lifePts=7, total=21
    const c = computeStrainComponents(600, 0, 0)!
    expect(c.total).toBe(21)
  })

})

describe('computeDailyStrain', () => {
  test('typical training day with life load', () => {
    // activityLoad=75, lifeLoad=3.78 → workout=7, life=3.78 → round(10.78)=11
    expect(computeDailyStrain(75, 3.78)).toBe(11)
  })

  test('rest day with high life load', () => {
    // activityLoad=0, lifeLoad=5.6 → round(5.6)=6
    expect(computeDailyStrain(0, 5.6)).toBe(6)
  })

  test('very high training load caps at 21', () => {
    expect(computeDailyStrain(600, 7)).toBe(21)
  })

  test('zero everything → 0', () => {
    expect(computeDailyStrain(0, 0)).toBe(0)
  })

  test('null activityLoad falls back to life only', () => {
    // round(3.5) = 4 (JS rounds .5 up)
    expect(computeDailyStrain(null, 3.5)).toBe(4)
  })

  test('null lifeLoad falls back to activity only', () => {
    // workout = (75/150)*14 = 7
    expect(computeDailyStrain(75, null)).toBe(7)
  })

  test('both null → null', () => {
    expect(computeDailyStrain(null, null)).toBeNull()
  })

  test('zero activityLoad with null lifeLoad → null', () => {
    expect(computeDailyStrain(0, null)).toBeNull()
  })
})

describe('strainLabel', () => {
  test('below 9 → low', () => expect(strainLabel(8)).toBe('low'))
  test('9 → moderate', () => expect(strainLabel(9)).toBe('moderate'))
  test('14 → moderate', () => expect(strainLabel(14)).toBe('moderate'))
  test('15 → high', () => expect(strainLabel(15)).toBe('high'))
  test('21 → high', () => expect(strainLabel(21)).toBe('high'))
})

describe('formatStrainForPrompt', () => {
  test('includes score and label', () => {
    const s = formatStrainForPrompt(11)
    expect(s).toContain('11')
    expect(s).toContain('21')
    expect(s).toContain('moderate')
  })

  test('null → empty string', () => {
    expect(formatStrainForPrompt(null)).toBe('')
  })

  test('appends sleep context when sleep is poor', () => {
    const s = formatStrainForPrompt(10, 45, null)
    expect(s).toContain('sleep 45/100')
  })

  test('appends battery context when battery is low', () => {
    const s = formatStrainForPrompt(10, null, 28)
    expect(s).toContain('body battery peak 28%')
  })

  test('appends sleep duration context when sleep is short', () => {
    const s = formatStrainForPrompt(10, null, null, 19800)  // 5.5h
    expect(s).toContain('slept 5.5h')
  })

  test('no sleep duration context when duration is sufficient', () => {
    const s = formatStrainForPrompt(10, null, null, 25200)  // 7h — above 6h threshold
    expect(s).not.toContain('slept')
  })

  test('no context when sleep and battery are good', () => {
    const s = formatStrainForPrompt(10, 80, 70)
    expect(s).not.toContain('sleep')
    expect(s).not.toContain('battery')
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
