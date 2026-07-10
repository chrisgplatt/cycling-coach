import { resolveFallbackFtp, resolveFallbackFtpForWorkout, type FtpAnchor } from '@/lib/ftp/resolve-ftp'

describe('resolveFallbackFtp', () => {
  it('returns the latest confirmed prediction on or before the date', () => {
    const anchors: FtpAnchor[] = [
      { createdAt: '2026-05-01T00:00:00Z', predictedFtp: 220 },
      { createdAt: '2026-06-01T00:00:00Z', predictedFtp: 235 },
    ]
    expect(resolveFallbackFtp('2026-06-15', anchors, null)).toBe(235)
  })

  it('ignores predictions after the date', () => {
    const anchors: FtpAnchor[] = [
      { createdAt: '2026-05-01T00:00:00Z', predictedFtp: 220 },
      { createdAt: '2026-07-01T00:00:00Z', predictedFtp: 250 },
    ]
    expect(resolveFallbackFtp('2026-06-15', anchors, null)).toBe(220)
  })

  it('treats a prediction dated exactly on the workout date as applicable', () => {
    const anchors: FtpAnchor[] = [{ createdAt: '2026-06-15T09:00:00Z', predictedFtp: 230 }]
    expect(resolveFallbackFtp('2026-06-15', anchors, null)).toBe(230)
  })

  it('falls back to the plan baseline when no prediction applies', () => {
    const anchors: FtpAnchor[] = [{ createdAt: '2026-07-01T00:00:00Z', predictedFtp: 250 }]
    expect(resolveFallbackFtp('2026-06-15', anchors, 210)).toBe(210)
  })

  it('returns null when neither a prediction nor a baseline applies', () => {
    expect(resolveFallbackFtp('2026-06-15', [], null)).toBeNull()
  })
})

describe('resolveFallbackFtpForWorkout', () => {
  function makeSupabase({
    predictions = [] as { created_at: string; predicted_ftp: number }[],
    planRow = null as { baseline_ftp: number | null } | null,
  } = {}) {
    return {
      from: (table: string) => {
        if (table === 'ftp_predictions') {
          return { select: () => ({ eq: () => ({ data: predictions }) }) }
        }
        if (table === 'training_plans') {
          return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: planRow }) }) }) }
        }
        throw new Error(`unexpected table ${table}`)
      },
    }
  }

  it('resolves from confirmed predictions when present', async () => {
    const supabase = makeSupabase({
      predictions: [{ created_at: '2026-06-01T00:00:00Z', predicted_ftp: 235 }],
    })
    const result = await resolveFallbackFtpForWorkout(supabase as never, '2026-06-15', null)
    expect(result).toBe(235)
  })

  it('falls back to the plan baseline when no prediction applies but a plan is given', async () => {
    const supabase = makeSupabase({ planRow: { baseline_ftp: 215 } })
    const result = await resolveFallbackFtpForWorkout(supabase as never, '2026-06-15', 'plan1')
    expect(result).toBe(215)
  })

  it('does not query training_plans when planId is null', async () => {
    const fromSpy = jest.fn((table: string) => {
      if (table === 'ftp_predictions') return { select: () => ({ eq: () => ({ data: [] }) }) }
      throw new Error(`unexpected table ${table}`)
    })
    const result = await resolveFallbackFtpForWorkout({ from: fromSpy } as never, '2026-06-15', null)
    expect(result).toBeNull()
    expect(fromSpy).not.toHaveBeenCalledWith('training_plans')
  })
})
