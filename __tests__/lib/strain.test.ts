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
  test('stress only — backwards compat', () => {
    // stress_avg=54 → (54/100)*3.5=1.89, avail=3.5 → (1.89/3.5)*7=3.78
    expect(computeDailyLifeLoad(54, null, null, null)).toBeCloseTo(3.78, 1)
  })

  test('stress + peak — peak blended at 30%', () => {
    // stress_avg=40, stress_high=80 → effective=52 → (52/100)*3.5=1.82 → (1.82/3.5)*7=3.64
    expect(computeDailyLifeLoad(40, 80, null, null)).toBeCloseTo(3.64, 1)
  })

  test('poor sleep only', () => {
    // sleep_score=30 → ((100-30)/100)*2=1.4, avail=2 → (1.4/2)*7=4.9
    expect(computeDailyLifeLoad(null, null, 30, null)).toBeCloseTo(4.9, 1)
  })

  test('low body battery only', () => {
    // body_battery_low=20 → ((100-20)/100)*1.5=1.2, avail=1.5 → (1.2/1.5)*7=5.6
    expect(computeDailyLifeLoad(null, null, null, 20)).toBeCloseTo(5.6, 1)
  })

  test('all three signals', () => {
    // stress=54→1.89, sleep=85→0.3, battery=75→0.375; raw=2.565, avail=7 → 2.565
    expect(computeDailyLifeLoad(54, null, 85, 75)).toBeCloseTo(2.565, 1)
  })

  test('great sleep + good battery softens score', () => {
    // stress=30→1.05, sleep=90→0.2, battery=85→0.225; raw=1.475, avail=7 → 1.475
    expect(computeDailyLifeLoad(30, null, 90, 85)).toBeCloseTo(1.475, 1)
  })

  test('all null → null', () => {
    expect(computeDailyLifeLoad(null, null, null, null)).toBeNull()
  })
})

describe('computeStrainComponents', () => {
  test('returns null when all inputs null', () => {
    expect(computeStrainComponents(null, null, null, null, null)).toBeNull()
  })

  test('workoutPts = (load / 400) * 14', () => {
    const c = computeStrainComponents(200, null, null, null, null)
    expect(c).not.toBeNull()
    expect(c!.workoutPts).toBeCloseTo(7, 1)   // (200/400)*14 = 7
    expect(c!.workoutLoad).toBe(200)
  })

  test('lifePts matches computeDailyLifeLoad', () => {
    const c = computeStrainComponents(0, 54, null, 85, 75)!
    const expected = computeDailyLifeLoad(54, null, 85, 75)!
    expect(c.lifePts).toBeCloseTo(expected, 4)
  })

  test('raw sub-scores are un-normalised', () => {
    // stress=54 only: raw = (54/100)*3.5 = 1.89; normalised life = 3.78
    // stressRawPts should be 1.89, not 3.78
    const c = computeStrainComponents(0, 54, null, null, null)!
    expect(c.stressRawPts).toBeCloseTo(1.89, 1)
    expect(c.sleepRawPts).toBe(0)
    expect(c.batteryRawPts).toBe(0)
  })

  test('source values pass through unchanged', () => {
    const c = computeStrainComponents(100, 60, 75, 72, 35)!
    expect(c.stressAvg).toBe(60)
    expect(c.stressHigh).toBe(75)
    expect(c.sleepScore).toBe(72)
    expect(c.bodyBatteryLow).toBe(35)
  })

  test('no workout today — workoutPts is 0', () => {
    const c = computeStrainComponents(0, 58, null, null, null)!
    expect(c.workoutPts).toBe(0)
    expect(c.workoutLoad).toBe(0)
  })
})

describe('computeDailyStrain', () => {
  test('typical hard training day with moderate life load', () => {
    // activityLoad=220, lifeLoad=3.78 → workout=7.7, life=3.78 → round(11.48)=11
    expect(computeDailyStrain(220, 3.78)).toBe(11)
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
    // workout = (200/400)*14 = 7
    expect(computeDailyStrain(200, null)).toBe(7)
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
    expect(s).toContain('body battery woke at 28%')
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
