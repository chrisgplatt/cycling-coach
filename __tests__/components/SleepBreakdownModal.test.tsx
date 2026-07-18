import { render, screen, fireEvent } from '@testing-library/react'
import SleepBreakdownModal from '@/components/SleepBreakdownModal'
import type { ICUWellness } from '@/types'

const baseWellness = {
  id: '2026-07-18', ctl: null, atl: null, form: null, hrv: null, resting_hr: null, sleep_secs: null,
  body_battery_low: null, body_battery_high: null, stress_avg: null, stress_high: null,
  garmin_training_load: null, sleep_score: null,
} as ICUWellness

test('shows the sleep score and band when present', () => {
  render(<SleepBreakdownModal wellness={{ ...baseWellness, sleep_score: 85 }} onClose={jest.fn()} />)
  expect(screen.getByText('85')).toBeInTheDocument()
  expect(screen.getByText('high')).toBeInTheDocument()
})

test('shows sleep stages when present', () => {
  render(<SleepBreakdownModal
    wellness={{ ...baseWellness, sleep_score: 70, garmin_sleep_deep_secs: 5400, garmin_sleep_rem_secs: 3600 }}
    onClose={jest.fn()}
  />)
  expect(screen.getByText(/Deep/)).toBeInTheDocument()
  expect(screen.getByText(/90m/)).toBeInTheDocument()
  expect(screen.getByText(/REM/)).toBeInTheDocument()
})

test('shows "Not synced" when no sleep score is available', () => {
  render(<SleepBreakdownModal wellness={baseWellness} onClose={jest.fn()} />)
  expect(screen.getByText('Not synced')).toBeInTheDocument()
})

test('close button calls onClose', () => {
  const onClose = jest.fn()
  render(<SleepBreakdownModal wellness={baseWellness} onClose={onClose} />)
  fireEvent.click(screen.getByText('Close'))
  expect(onClose).toHaveBeenCalled()
})
