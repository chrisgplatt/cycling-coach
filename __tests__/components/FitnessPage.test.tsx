import { render, screen, fireEvent } from '@testing-library/react'
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
    if (url.includes('/api/hrv/improvement')) {
      return Promise.resolve({ ok: true, json: async () => ({ improvement: { hasEnoughHistory: false }, coachNote: null }) })
    }
    return Promise.resolve({ ok: true, json: async () => ([]) })
  })
})
afterEach(() => jest.clearAllMocks())

// jsdom has no PointerEvent implementation (jsdom/jsdom#1888): fireEvent.pointerEnter/Leave
// silently drop `pointerType`, AND React synthesizes onPointerEnter/onPointerLeave from the
// bubbling pointerover/pointerout events (enter/leave don't bubble), not from enter/leave
// events directly. Dispatch pointerover/pointerout with pointerType attached manually so the
// component's handlers see the same pointerType a real browser would deliver.
function hoverIn(el: Element, pointerType: 'mouse' | 'touch') {
  const event = new Event('pointerover', { bubbles: true })
  Object.defineProperty(event, 'pointerType', { value: pointerType })
  fireEvent(el, event)
}
function hoverOut(el: Element, pointerType: 'mouse' | 'touch') {
  const event = new Event('pointerout', { bubbles: true })
  Object.defineProperty(event, 'pointerType', { value: pointerType })
  fireEvent(el, event)
}

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

it('shows component breakdown when a mouse hovers anywhere in a Recovery graph day-slot, and hides it on leave', async () => {
  render(<FitnessPage />)
  await screen.findByText('Recovery')
  const point = screen.getByTestId('recovery-hit-0')

  // The hit-slot spans the full chart height, not just the plotted dot's exact
  // y-coordinate — this is what makes hover actually easy to trigger.
  hoverIn(point, 'mouse')
  expect(screen.getByText('Recovery').closest('.rounded-xl')).toHaveTextContent(/Sleep \d+/)

  hoverOut(point, 'mouse')
  expect(screen.getByText('Recovery').closest('.rounded-xl')).not.toHaveTextContent(/Sleep \d+/)
})

it('does not show component breakdown on touch hover-in (avoids intercepting a tap-to-select)', async () => {
  render(<FitnessPage />)
  await screen.findByText('Recovery')
  const point = screen.getByTestId('recovery-hit-0')

  hoverIn(point, 'touch')
  expect(screen.getByText('Recovery').closest('.rounded-xl')).not.toHaveTextContent(/Sleep \d+/)
})

it('tap-to-select still toggles the breakdown on and off (mobile has no hover)', async () => {
  render(<FitnessPage />)
  await screen.findByText('Recovery')
  const point = screen.getByTestId('recovery-hit-0')

  // Real touch devices fire a synthetic pointerenter/mouseenter just before click;
  // simulate that ordering to guard against the regression where hover-priming
  // made the very next click's toggle see "already selected" and turn it back off.
  hoverIn(point, 'touch')
  fireEvent.click(point)
  expect(screen.getByText('Recovery').closest('.rounded-xl')).toHaveTextContent(/Sleep \d+/)

  fireEvent.click(point)
  expect(screen.getByText('Recovery').closest('.rounded-xl')).not.toHaveTextContent(/Sleep \d+/)
})
