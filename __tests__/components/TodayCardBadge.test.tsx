import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import TodayCard from '@/components/TodayCard'

beforeEach(() => {
  localStorage.clear()
  jest.spyOn(global, 'fetch').mockResolvedValue({
    ok: true,
    json: async () => ({ coach_note: 'Hit the intervals.', verdict: 'green', headline: 'Go hard' }),
  } as Response)
})
afterEach(() => jest.restoreAllMocks())

it('shows the readiness badge when the briefing returns a verdict', async () => {
  render(<TodayCard workout={null} wellness={null} />)
  fireEvent.click(screen.getByRole('button', { name: /coach's note/i }))
  await waitFor(() => expect(screen.getByTestId('readiness-badge')).toBeInTheDocument())
  expect(screen.getByTestId('readiness-badge')).toHaveTextContent(/GO HARD/i)
})

it('renders the weather strip when the briefing returns weather', async () => {
  localStorage.clear()
  ;(global.fetch as jest.Mock).mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      coach_note: 'Take the intervals indoors.',
      verdict: 'green', headline: 'Go hard',
      weather: {
        temp_min_c: 8, temp_max_c: 14, precip_prob_pct: 80,
        wind_max_kph: 30, gust_max_kph: 50, weather_code: 65, description: 'Heavy rain',
      },
    }),
  })
  render(<TodayCard workout={null} wellness={null} />)
  fireEvent.click(screen.getByRole('button', { name: /coach's note/i }))
  expect(await screen.findByTestId('weather-strip')).toHaveTextContent('Heavy rain')
})

it('shows Recovery score chip when wellness data is available', () => {
  const wellness = {
    id: '2026-06-30',
    ctl: 60, atl: 65, form: -5, hrv: 52, resting_hr: 58,
    sleep_secs: 28800, body_battery_low: 30, body_battery_high: 85,
    stress_avg: null, stress_high: null, garmin_training_load: null, sleep_score: null,
    garmin_sleep_deep_secs: 5760, garmin_sleep_light_secs: 14400,
    garmin_sleep_rem_secs: 7200, garmin_sleep_awake_secs: 1440,
  }
  render(<TodayCard workout={null} wellness={wellness} hrvBaseline={50} />)
  expect(screen.getByText('Recovery')).toBeInTheDocument()
  // score should be visible as a number
  expect(screen.getByTestId('recovery-score')).toBeInTheDocument()
})
