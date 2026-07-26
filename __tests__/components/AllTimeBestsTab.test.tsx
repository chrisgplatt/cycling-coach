import { render, screen, fireEvent } from '@testing-library/react'
import AllTimeBestsTab from '@/components/AllTimeBestsTab'
import type { AllTimeBests, IndoorOutdoorBestsResponse } from '@/lib/ride/all-time-bests'

const EMPTY_BESTS: AllTimeBests = { biggestClimb: [], longestClimb: [], powerBests: [], speedBests: [], maxSpeed: [] }

function makeResponse(overrides: Partial<IndoorOutdoorBestsResponse> = {}): IndoorOutdoorBestsResponse {
  return {
    outdoor: {
      allTime: {
        biggestClimb: [
          { rank: 1, workoutId: 'w1', icuActivityId: 'icu-1', date: '2026-03-15', elev_gain_m: 620, length_km: 8.4 },
        ],
        longestClimb: [
          { rank: 1, workoutId: 'w2', icuActivityId: 'icu-2', date: '2025-11-02', length_km: 12.1, elev_gain_m: 480 },
        ],
        powerBests: [
          { rank: 1, secs: 300, watts: 312, workoutId: 'w3', icuActivityId: 'icu-3', date: '2026-01-10' },
        ],
        speedBests: [
          { rank: 1, distance_km: 10, avg_speed_kmh: 38.4, workoutId: 'w4', icuActivityId: 'icu-4', date: '2026-05-01' },
        ],
        maxSpeed: [
          { rank: 1, workoutId: 'w5', icuActivityId: 'icu-5', date: '2024-07-04', speed_kmh: 68.2, max_speed_ms: 18.9 },
        ],
      },
      byYear: {
        '2026': {
          biggestClimb: [{ rank: 1, workoutId: 'w1', icuActivityId: 'icu-1', date: '2026-03-15', elev_gain_m: 620, length_km: 8.4 }],
          longestClimb: [], powerBests: [], speedBests: [], maxSpeed: [],
        },
        '2025': {
          biggestClimb: [],
          longestClimb: [{ rank: 1, workoutId: 'w2', icuActivityId: 'icu-2', date: '2025-11-02', length_km: 12.1, elev_gain_m: 480 }],
          powerBests: [], speedBests: [], maxSpeed: [],
        },
      },
    },
    indoor: { allTime: EMPTY_BESTS, byYear: {} },
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

  it('renders outdoor all-time bests by default', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue({ ok: true, json: async () => makeResponse() })
    render(<AllTimeBestsTab />)
    expect(await screen.findByText('620')).toBeInTheDocument()   // biggest climb elevation
    expect(screen.getByText(/8\.4km/)).toBeInTheDocument()        // biggest climb caption
    expect(screen.getByText('12.1')).toBeInTheDocument()          // longest climb length
    expect(screen.getByText('312')).toBeInTheDocument()           // power best watts
    expect(screen.getByText('38.4')).toBeInTheDocument()          // speed best
    expect(screen.getByText('68.2')).toBeInTheDocument()          // max speed
  })

  it('renders Outdoor/Indoor toggle buttons plus an All-time chip and one chip per byYear entry, most recent year first', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue({ ok: true, json: async () => makeResponse() })
    render(<AllTimeBestsTab />)
    await screen.findByText('620')
    const chips = screen.getAllByRole('button').map(b => b.textContent)
    expect(chips).toEqual(['Outdoor', 'Indoor', 'All-time', '2026', '2025'])
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

  it('switching to Indoor shows indoor bests and resets the period back to All-time', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => makeResponse({
        indoor: {
          allTime: { ...EMPTY_BESTS, maxSpeed: [{ rank: 1, workoutId: null, icuActivityId: 'icu-9', date: '2026-06-01', speed_kmh: 45.2, max_speed_ms: 12.6 }] },
          byYear: {},
        },
      }),
    })
    render(<AllTimeBestsTab />)
    await screen.findByText('620')

    fireEvent.click(screen.getByRole('button', { name: '2025' }))
    await screen.findByText('12.1')

    fireEvent.click(screen.getByRole('button', { name: 'Indoor' }))

    expect(screen.queryByText('620')).not.toBeInTheDocument()
    expect(screen.queryByText('12.1')).not.toBeInTheDocument()
    expect(await screen.findByText('45.2')).toBeInTheDocument()
    // switching surface drops the other surface's year chips and returns to All-time
    expect(screen.queryByRole('button', { name: '2025' })).not.toBeInTheDocument()
  })

  it('hides sections with no data for the selected period and shows an empty message when all are absent', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => makeResponse({ outdoor: { allTime: EMPTY_BESTS, byYear: {} } }),
    })
    render(<AllTimeBestsTab />)
    expect(await screen.findByText('No ride data yet for this period.')).toBeInTheDocument()
    expect(screen.queryByText('Biggest Climb')).not.toBeInTheDocument()
  })

  it('renders the Biggest Climb caption without a bogus length when length_km is null (un-backfilled data)', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => makeResponse({
        outdoor: {
          allTime: { biggestClimb: [{ rank: 1, workoutId: 'w1', icuActivityId: 'icu-1', date: '2026-03-15', elev_gain_m: 620, length_km: null }], longestClimb: [], powerBests: [], speedBests: [], maxSpeed: [] },
          byYear: {},
        },
      }),
    })
    render(<AllTimeBestsTab />)
    expect(await screen.findByText('620')).toBeInTheDocument()
    expect(screen.queryByText(/undefined/)).not.toBeInTheDocument()
  })

  it('links each entry to its intervals.icu activity page', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue({ ok: true, json: async () => makeResponse() })
    render(<AllTimeBestsTab />)
    await screen.findByText('620')
    const links = screen.getAllByRole('link', { name: /View on intervals\.icu/i })
    expect(links.length).toBeGreaterThanOrEqual(5) // at least one for each category
    expect(links[0]).toHaveAttribute('href', 'https://intervals.icu/activities/icu-1')
    expect(links[0]).toHaveAttribute('target', '_blank')
    expect(links[1]).toHaveAttribute('href', 'https://intervals.icu/activities/icu-2')
  })

  it('does not show an expand toggle when a category has only one podium entry', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue({ ok: true, json: async () => makeResponse() })
    render(<AllTimeBestsTab />)
    await screen.findByText('620')
    expect(screen.queryByRole('button', { name: /runners-up/i })).not.toBeInTheDocument()
  })

  it('reveals 2nd and 3rd place when the expand toggle is clicked, and hides them again on a second click', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => makeResponse({
        outdoor: {
          allTime: {
            biggestClimb: [
              { rank: 1, workoutId: 'w1', icuActivityId: 'icu-1', date: '2026-03-15', elev_gain_m: 620, length_km: 8.4 },
              { rank: 2, workoutId: 'w2', icuActivityId: 'icu-2', date: '2026-02-01', elev_gain_m: 580, length_km: 7.1 },
              { rank: 3, workoutId: 'w3', icuActivityId: 'icu-3', date: '2026-01-01', elev_gain_m: 540, length_km: 6.5 },
            ],
            longestClimb: [], powerBests: [], speedBests: [], maxSpeed: [],
          },
          byYear: {},
        },
      }),
    })
    render(<AllTimeBestsTab />)
    await screen.findByText('620')

    expect(screen.queryByText('580')).not.toBeInTheDocument()
    const toggle = screen.getByRole('button', { name: 'Show Elevation runners-up' })
    fireEvent.click(toggle)

    expect(await screen.findByText('580')).toBeInTheDocument()
    expect(screen.getByText('540')).toBeInTheDocument()
    expect(screen.getByText('#2 Elevation')).toBeInTheDocument()
    expect(screen.getByText('#3 Elevation')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Hide Elevation runners-up' }))
    expect(screen.queryByText('580')).not.toBeInTheDocument()
  })
})
