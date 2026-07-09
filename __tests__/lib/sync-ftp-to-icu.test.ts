import { syncFtpToIntervalsIcu } from '@/lib/profile/sync-ftp-to-icu'

const mockUpdateRideFTP = jest.fn()

jest.mock('@/lib/intervals/client', () => ({
  IntervalsClient: jest.fn().mockImplementation(() => ({
    updateRideFTP: mockUpdateRideFTP,
  })),
}))

function makeSupabase(profileRow: unknown) {
  return {
    from: () => ({
      select: () => ({ maybeSingle: async () => ({ data: profileRow }) }),
    }),
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockUpdateRideFTP.mockResolvedValue(undefined)
})

describe('syncFtpToIntervalsIcu', () => {
  it('pushes the new FTP to intervals.icu when credentials are configured', async () => {
    const supabase = makeSupabase({ intervals_icu_athlete_id: 'i1', intervals_icu_api_key: 'k' })
    await syncFtpToIntervalsIcu(supabase as never, 230)
    expect(mockUpdateRideFTP).toHaveBeenCalledWith(230)
  })

  it('does nothing when intervals.icu is not configured', async () => {
    const supabase = makeSupabase({ intervals_icu_athlete_id: null, intervals_icu_api_key: null })
    await syncFtpToIntervalsIcu(supabase as never, 230)
    expect(mockUpdateRideFTP).not.toHaveBeenCalled()
  })

  it('does not throw when the intervals.icu request fails', async () => {
    mockUpdateRideFTP.mockRejectedValue(new Error('icu down'))
    const supabase = makeSupabase({ intervals_icu_athlete_id: 'i1', intervals_icu_api_key: 'k' })
    await expect(syncFtpToIntervalsIcu(supabase as never, 230)).resolves.toBeUndefined()
  })
})
