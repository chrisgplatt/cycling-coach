import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import ActivityDetailModal from '@/components/ActivityDetailModal'
import type { ICUActivity } from '@/types'

const activity: ICUActivity = {
  id: 'a1', start_date_local: '2026-05-20T07:00:00', type: 'Ride', moving_time: 3600,
  name: 'Evening Ride', average_watts: 190, max_watts: 300, weighted_average_watts: 205,
  average_heartrate: 140, training_load: 78, rolling_ftp: null, distance: 25000,
  total_elevation_gain: 210, left_right_balance: null,
}

describe('ActivityDetailModal', () => {
  it('shows Stats and Map tabs and renders ride stats by default', () => {
    global.fetch = jest.fn(() => Promise.resolve({ ok: true, json: async () => ({ streams: null }) })) as never
    render(<ActivityDetailModal activity={activity} onClose={() => {}} />)
    expect(screen.getByRole('tab', { name: 'Stats' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Map' })).toBeInTheDocument()
    expect(screen.getByText('NP')).toBeInTheDocument()
    expect(screen.getByText('205')).toBeInTheDocument()
  })

  it('renders the distribution histogram when the activity has one', async () => {
    global.fetch = jest.fn((url: string) =>
      String(url).includes('/distributions')
        ? Promise.resolve({ ok: true, json: async () => ({ distributions: {
            power: [{ edge: 50, secs: 300 }, { edge: 100, secs: 900 }],
            power_vi: 1.12, power_steady_pct: 40,
            cadence: null, coasting_secs: null, hr: null, hr_lthr: null,
          } }) })
        : Promise.resolve({ ok: true, json: async () => ({ streams: null }) }),
    ) as never
    render(<ActivityDetailModal activity={activity} onClose={() => {}} />)
    expect(await screen.findByText(/VI 1.12/)).toBeInTheDocument()
  })

  it('fetches the activity streams when the Map tab is opened', async () => {
    const fetchMock = jest.fn(() => Promise.resolve({ ok: true, json: async () => ({ streams: { time: [0], power: [100], distance: [0], latlng: null, hr: null, altitude: null, cadence: null, velocity: null } }) }))
    global.fetch = fetchMock as never
    render(<ActivityDetailModal activity={activity} onClose={() => {}} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Map' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(c => String((c as unknown[])[0]).includes('/api/rides/activity/a1/streams'))).toBe(true))
  })

  it('never shows a Highlights tab (highlights moved into the Map tab)', async () => {
    global.fetch = jest.fn((url: string) =>
      String(url).includes('/highlights')
        ? Promise.resolve({ ok: true, json: async () => ({
            climbs: [{ start_km: 5, duration_secs: 480, elev_gain_m: 90, avg_watts: 268, vam: 675 }],
            effort_periods: null, sprints: null, personal_bests: null,
          }) })
        : Promise.resolve({ ok: true, json: async () => ({ streams: null }) }),
    ) as never
    render(<ActivityDetailModal activity={activity} onClose={() => {}} />)
    await screen.findByRole('tab', { name: 'Stats' })
    expect(screen.queryByRole('tab', { name: 'Highlights' })).toBeNull()
  })

  it('renders highlight cards under the Map tab when the highlights fetch returns at least one highlight', async () => {
    global.fetch = jest.fn((url: string) =>
      String(url).includes('/highlights')
        ? Promise.resolve({ ok: true, json: async () => ({
            climbs: [{ start_km: 5, duration_secs: 480, elev_gain_m: 90, avg_watts: 268, vam: 675 }],
            effort_periods: null, sprints: null, personal_bests: null,
          }) })
        : String(url).includes('/streams')
          ? Promise.resolve({ ok: true, json: async () => ({
              streams: { time: [0, 60, 120], distance: [0, 2500, 5000], latlng: null, power: [100, 100, 100], hr: null, altitude: null, cadence: null, velocity: null },
            }) })
          : Promise.resolve({ ok: true, json: async () => ({ distributions: null }) }),
    ) as never
    render(<ActivityDetailModal activity={activity} onClose={() => {}} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Map' }))
    expect(await screen.findByText(/Climb/)).toBeInTheDocument()
  })
})
