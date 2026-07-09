import { render, screen, fireEvent, waitFor } from '@testing-library/react'
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

describe('FTP prediction confirm-before-save flow', () => {
  const predictResponse = { predicted_ftp: 230, reasoning: 'Solid block.', confidence: 'medium', activity_ids: ['a1'] }
  const confirmResponse = { id: 'p1', ...predictResponse, confirmed: false, created_at: '2026-07-09T00:00:00Z' }

  function mockFetchWithFtpFlow(options?: { applyFails?: boolean }) {
    ;(global.fetch as jest.Mock).mockImplementation((url: string, opts?: RequestInit) => {
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
      if (url.includes('/api/ftp/confirm')) {
        return Promise.resolve({ ok: true, json: async () => confirmResponse })
      }
      if (url.match(/\/api\/ftp\/.+\/apply/)) {
        if (options?.applyFails) {
          return Promise.resolve({ ok: false, status: 500, json: async () => ({ error: 'apply failed' }) })
        }
        return Promise.resolve({ ok: true, json: async () => ({ ...confirmResponse, confirmed: true }) })
      }
      if (url.includes('/api/ftp') && opts?.method === 'POST') {
        return Promise.resolve({ ok: true, json: async () => predictResponse })
      }
      if (url.includes('/api/ftp')) {
        return Promise.resolve({ ok: true, json: async () => ([]) })
      }
      if (url.includes('/api/profile')) {
        return Promise.resolve({ ok: true, json: async () => ({ current_ftp: 220 }) })
      }
      return Promise.resolve({ ok: true, json: async () => ([]) })
    })
  }

  it('shows a Save/Discard draft after predicting, without adding it to saved history', async () => {
    mockFetchWithFtpFlow()
    render(<FitnessPage />)
    await screen.findByText('Sleep')
    fireEvent.click(screen.getByRole('button', { name: 'Predict FTP' }))
    await screen.findByText('Not saved yet')
    expect(screen.getByText('230')).toBeInTheDocument()
    expect(screen.getByText('Save prediction')).toBeInTheDocument()
    expect(screen.getByText('Discard')).toBeInTheDocument()
  })

  it('Discard clears the draft without saving it', async () => {
    mockFetchWithFtpFlow()
    render(<FitnessPage />)
    await screen.findByText('Sleep')
    fireEvent.click(screen.getByRole('button', { name: 'Predict FTP' }))
    await screen.findByText('Not saved yet')
    fireEvent.click(screen.getByText('Discard'))
    expect(screen.queryByText('Not saved yet')).not.toBeInTheDocument()
    const confirmCalls = (global.fetch as jest.Mock).mock.calls.filter(([url]) => String(url).includes('/api/ftp/confirm'))
    expect(confirmCalls).toHaveLength(0)
  })

  it('Save calls the confirm endpoint and moves the prediction into saved history', async () => {
    mockFetchWithFtpFlow()
    render(<FitnessPage />)
    await screen.findByText('Sleep')
    fireEvent.click(screen.getByRole('button', { name: 'Predict FTP' }))
    await screen.findByText('Not saved yet')
    fireEvent.click(screen.getByText('Save prediction'))
    await waitFor(() => expect(screen.queryByText('Not saved yet')).not.toBeInTheDocument())
    expect(screen.getAllByText('230').length).toBeGreaterThan(0)
  })

  it('opens the apply modal after saving when the prediction differs from current FTP, and applying updates the displayed FTP', async () => {
    mockFetchWithFtpFlow()
    render(<FitnessPage />)
    await screen.findByText('Sleep')
    fireEvent.click(screen.getByRole('button', { name: 'Predict FTP' }))
    await screen.findByText('Not saved yet')
    fireEvent.click(screen.getByText('Save prediction'))
    await screen.findByText('Update profile FTP?')
    fireEvent.click(screen.getByText('Update to 230W'))
    await screen.findByText('✓ applied to profile')
  })

  it('declining the apply modal leaves the prediction saved but not applied', async () => {
    mockFetchWithFtpFlow()
    render(<FitnessPage />)
    await screen.findByText('Sleep')
    fireEvent.click(screen.getByRole('button', { name: 'Predict FTP' }))
    await screen.findByText('Not saved yet')
    fireEvent.click(screen.getByText('Save prediction'))
    await screen.findByText('Update profile FTP?')
    fireEvent.click(screen.getByText('Keep current'))
    expect(screen.queryByText('Update profile FTP?')).not.toBeInTheDocument()
    expect(screen.queryByText('✓ applied to profile')).not.toBeInTheDocument()
  })

  it('shows an error and keeps the apply modal open when the apply PATCH fails', async () => {
    mockFetchWithFtpFlow({ applyFails: true })
    render(<FitnessPage />)
    await screen.findByText('Sleep')
    fireEvent.click(screen.getByRole('button', { name: 'Predict FTP' }))
    await screen.findByText('Not saved yet')
    fireEvent.click(screen.getByText('Save prediction'))
    await screen.findByText('Update profile FTP?')
    fireEvent.click(screen.getByText('Update to 230W'))
    await screen.findByText('apply failed')
    expect(screen.getByText('Update profile FTP?')).toBeInTheDocument()
  })
})
