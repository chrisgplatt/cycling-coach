/** @jest-environment node */
import { computeDailyStrain, strainLabel, formatStrainForPrompt, formatStrainHistoryForPrompt } from '@/lib/strain'

describe('computeDailyStrain', () => {
  test('typical hard training day', () => {
    // trainingLoad=220, stressAvg=54
    // workout = (220/400)*14 = 7.7, life = (54/100)*7 = 3.78 → round(11.48) = 11
    expect(computeDailyStrain(220, 54)).toBe(11)
  })

  test('rest day with moderate stress', () => {
    // trainingLoad=0, stressAvg=80
    // workout = 0, life = (80/100)*7 = 5.6 → round(5.6) = 6
    expect(computeDailyStrain(0, 80)).toBe(6)
  })

  test('very high training load caps at 21', () => {
    expect(computeDailyStrain(600, 100)).toBe(21)
  })

  test('zero everything → 0', () => {
    expect(computeDailyStrain(0, 0)).toBe(0)
  })

  test('null trainingLoad falls back to stress only', () => {
    // workout = 0, life = (50/100)*7 = 3.5 → round(3.5) = 4 (JS rounds .5 up)
    expect(computeDailyStrain(null, 50)).toBe(4)
  })

  test('null stressAvg falls back to training only', () => {
    // workout = (200/400)*14 = 7, life = 0 → 7
    expect(computeDailyStrain(200, null)).toBe(7)
  })

  test('both null → null', () => {
    expect(computeDailyStrain(null, null)).toBeNull()
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
