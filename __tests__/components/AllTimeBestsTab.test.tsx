import { render, screen, fireEvent } from '@testing-library/react'
import AllTimeBestsTab from '@/components/AllTimeBestsTab'
import type { AllTimeBestsResponse } from '@/lib/ride/all-time-bests'

function makeResponse(overrides: Partial<AllTimeBestsResponse> = {}): AllTimeBestsResponse {
  return {
    allTime: {
      biggestClimb: { workoutId: 'w1', date: '2026-03-15', elev_gain_m: 620, length_km: 8.4 },
      longestClimb: { workoutId: 'w2', date: '2025-11-02', length_km: 12.1, elev_gain_m: 480 },
      powerBests: [{ secs: 300, watts: 312, workoutId: 'w3', date: '2026-01-10' }],
      speedBests: [{ distance_km: 10, avg_speed_kmh: 38.4, workoutId: 'w4', date: '2026-05-01' }],
      maxSpeed: { workoutId: 'w5', date: '2024-07-04', speed_kmh: 68.2 },
    },
    byYear: {
      '2026': {
        biggestClimb: { workoutId: 'w1', date: '2026-03-15', elev_gain_m: 620, length_km: 8.4 },
        longestClimb: null, powerBests: [], speedBests: [], maxSpeed: null,
      },
      '2025': {
        biggestClimb: null,
        longestClimb: { workoutId: 'w2', date: '2025-11-02', length_km: 12.1, elev_gain_m: 480 },
        powerBests: [], speedBests: [], maxSpeed: null,
      },
    },
    ...overrides,
  }
}

global.fetch = jest.fn()

describe('AllTimeBestsTab', () => {
  afterEach(() => jest.clearAllMocks())

  it('shows a loading state while fetching', () => {
    ;(global.fetch as jest.Mock).mockReturnValue(new Promise(() => {}))
    render(<AllTimeBestsTab />)
    expect(document.querySelector('.animate-spin')).toBeInTheDocument()
  })

  it('renders all-time bests by default', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue({ ok: true, json: async () => makeResponse() })
    render(<AllTimeBestsTab />)
    expect(await screen.findByText('620')).toBeInTheDocument()   // biggest climb elevation
    expect(screen.getByText(/8\.4km/)).toBeInTheDocument()        // biggest climb caption
    expect(screen.getByText('12.1')).toBeInTheDocument()          // longest climb length
    expect(screen.getByText('312')).toBeInTheDocument()           // power best watts
    expect(screen.getByText('38.4')).toBeInTheDocument()          // speed best
    expect(screen.getByText('68.2')).toBeInTheDocument()          // max speed
  })

  it('renders an All-time chip plus one chip per byYear entry, most recent year first', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue({ ok: true, json: async () => makeResponse() })
    render(<AllTimeBestsTab />)
    await screen.findByText('620')
    const chips = screen.getAllByRole('button').map(b => b.textContent)
    expect(chips).toEqual(['All-time', '2026', '2025'])
  })

  it('clicking a year chip re-scopes the sections without an extra fetch', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue({ ok: true, json: async () => makeResponse() })
    render(<AllTimeBestsTab />)
    await screen.findByText('620')
    expect(global.fetch).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: '2025' }))

    expect(screen.queryByText('620')).not.toBeInTheDocument()      // 2026's biggest climb no longer shown
    expect(await screen.findByText('12.1')).toBeInTheDocument()    // 2025's longest climb shown
    expect(global.fetch).toHaveBeenCalledTimes(1)                  // still just the one initial fetch
  })

  it('hides sections with no data for the selected period and shows an empty message when all are absent', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => makeResponse({
        allTime: { biggestClimb: null, longestClimb: null, powerBests: [], speedBests: [], maxSpeed: null },
        byYear: {},
      }),
    })
    render(<AllTimeBestsTab />)
    expect(await screen.findByText('No ride data yet for this period.')).toBeInTheDocument()
    expect(screen.queryByText('Biggest Climb')).not.toBeInTheDocument()
  })

  it('renders the Biggest Climb caption without a bogus length when length_km is null (un-backfilled data)', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => makeResponse({
        allTime: {
          biggestClimb: { workoutId: 'w1', date: '2026-03-15', elev_gain_m: 620, length_km: null },
          longestClimb: null, powerBests: [], speedBests: [], maxSpeed: null,
        },
        byYear: {},
      }),
    })
    render(<AllTimeBestsTab />)
    expect(await screen.findByText('620')).toBeInTheDocument()
    expect(screen.queryByText(/undefined/)).not.toBeInTheDocument()
  })
})
