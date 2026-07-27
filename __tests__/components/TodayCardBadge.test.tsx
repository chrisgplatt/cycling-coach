import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import TodayCard from '@/components/TodayCard'
import { makeWorkout } from '../support/factories'

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

it('shows a generated date and time after the coach note', async () => {
  render(<TodayCard workout={null} wellness={null} />)
  fireEvent.click(screen.getByRole('button', { name: /coach's note/i }))
  await waitFor(() => expect(screen.getByText('Hit the intervals.')).toBeInTheDocument())
  expect(screen.getByTestId('note-generated-at')).toHaveTextContent(/^Generated /)
})

it('reuses the cached generated timestamp on a repeat render instead of stamping the current time', async () => {
  const { unmount } = render(<TodayCard workout={null} wellness={null} />)
  fireEvent.click(screen.getByRole('button', { name: /coach's note/i }))
  await waitFor(() => expect(screen.getByText('Hit the intervals.')).toBeInTheDocument())
  const firstStamp = screen.getByTestId('note-generated-at').textContent
  // global.fetch is a single mock shared across this whole test file (seeded once in
  // jest.setup.ts), so its call count accumulates across tests — compare a delta from
  // this point, not an absolute count.
  const callsBeforeRemount = (global.fetch as jest.Mock).mock.calls.length
  unmount()

  render(<TodayCard workout={null} wellness={null} />)
  fireEvent.click(screen.getByRole('button', { name: /coach's note/i }))
  await waitFor(() => expect(screen.getByText('Hit the intervals.')).toBeInTheDocument())
  expect(screen.getByTestId('note-generated-at').textContent).toBe(firstStamp)
  // The second mount should read from cache, not hit the network again.
  expect((global.fetch as jest.Mock).mock.calls.length).toBe(callsBeforeRemount)
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

it('shows medal icons on the workout card when medals are present', async () => {
  const workout = makeWorkout({ status: 'completed' })
  render(<TodayCard workout={workout} wellness={null} medals={{ allTime: [{ category: 'power', subKey: '300', rank: 1 }], year: [] }} />)
  expect(await screen.findByTitle('All-time record')).toBeInTheDocument()
})

it('shows no medal icons when medals is absent', async () => {
  const workout = makeWorkout({ status: 'completed' })
  render(<TodayCard workout={workout} wellness={null} />)
  fireEvent.click(screen.getByRole('button', { name: /coach's note/i }))
  await waitFor(() => expect(screen.getByTestId('readiness-badge')).toBeInTheDocument())
  expect(screen.queryByTitle('All-time record')).not.toBeInTheDocument()
  expect(screen.queryByTitle('Year-best record')).not.toBeInTheDocument()
})

