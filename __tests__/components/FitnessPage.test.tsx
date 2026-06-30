import { render, screen } from '@testing-library/react'
import FitnessPage from '@/app/fitness/page'

// Minimal fetch mock — the page fetches /api/ftp, /api/profile, /api/charts, /api/weight-log, /api/hrv/improvement
beforeEach(() => {
  ;(global.fetch as jest.Mock).mockImplementation((url: string) => {
    if (url.includes('/api/charts')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          charts: {
            wellness: [
              {
                id: '2026-06-30',
                ctl: 60, atl: 65, form: -5, hrv: 52, resting_hr: 58,
                sleep_secs: 28800, body_battery_low: 30, body_battery_high: 85,
                stress_avg: null, stress_high: null, garmin_training_load: null, sleep_score: null,
                garmin_sleep_deep_secs: 5760, garmin_sleep_light_secs: 14400,
                garmin_sleep_rem_secs: 7200, garmin_sleep_awake_secs: 1440,
              },
            ],
            weeklyTss: [],
          },
        }),
      })
    }
    if (url.includes('/api/weight-log')) {
      return Promise.resolve({ ok: true, json: async () => ({ entries: [] }) })
    }
    return Promise.resolve({ ok: true, json: async () => ([]) })
  })
})
afterEach(() => jest.clearAllMocks())

it('renders Sleep section when garmin sleep data is present', async () => {
  render(<FitnessPage />)
  // Section heading appears after charts load
  await screen.findByText('Sleep')
  expect(screen.getByText('Sleep')).toBeInTheDocument()
})

it('renders Recovery section when wellness data is present', async () => {
  const { default: FitnessPage } = await import('@/app/fitness/page')
  render(<FitnessPage />)
  await screen.findByText('Sleep')
  expect(screen.getByText('Recovery')).toBeInTheDocument()
})
