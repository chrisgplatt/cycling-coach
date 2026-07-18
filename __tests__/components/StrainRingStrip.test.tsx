import { render, screen, fireEvent } from '@testing-library/react'
import StrainRingStrip from '@/components/StrainRingStrip'
import type { ICUWellness } from '@/types'

const wellness = {
  id: '2026-07-18', ctl: null, atl: null, form: null, hrv: null, resting_hr: null, sleep_secs: null,
  body_battery_low: null, body_battery_high: null, stress_avg: null, stress_high: null,
  garmin_training_load: null, sleep_score: 85,
} as ICUWellness

const recovery = { score: 78, band: 'high' as const, explanation: '', components: { sleep: 80, hrv: 75, wellness: null, tsb: null, bodyBattery: null } }
const strainToday = { date: '2026-07-18', dailyTrimp: 108, trimpRef: 150, workoutStrain: 13 }

test('renders all three rings with their values', () => {
  render(
    <StrainRingStrip recovery={recovery} strainToday={strainToday} wellness={wellness} activities={[]} maxHr={190} restingHr={50} />
  )
  expect(screen.getByText('78')).toBeInTheDocument()
  expect(screen.getByText('13')).toBeInTheDocument()
  expect(screen.getByText('85')).toBeInTheDocument()
})

test('tapping the Strain ring opens the strain breakdown sheet', () => {
  render(
    <StrainRingStrip recovery={recovery} strainToday={strainToday} wellness={wellness} activities={[]} maxHr={190} restingHr={50} />
  )
  fireEvent.click(screen.getByRole('button', { name: /Strain breakdown/i }))
  expect(screen.getByText('Strain Breakdown')).toBeInTheDocument()
})

test('tapping the Recovery ring opens the recovery breakdown modal', () => {
  render(
    <StrainRingStrip recovery={recovery} strainToday={strainToday} wellness={wellness} activities={[]} maxHr={190} restingHr={50} />
  )
  fireEvent.click(screen.getByRole('button', { name: /Recovery breakdown/i }))
  expect(screen.getByText('Recovery Breakdown')).toBeInTheDocument()
})

test('tapping the Sleep ring opens the sleep breakdown modal', () => {
  render(
    <StrainRingStrip recovery={recovery} strainToday={strainToday} wellness={wellness} activities={[]} maxHr={190} restingHr={50} />
  )
  fireEvent.click(screen.getByRole('button', { name: /Sleep breakdown/i }))
  expect(screen.getByText('Sleep Breakdown')).toBeInTheDocument()
})

test('renders placeholder dashes when strainToday is null', () => {
  render(
    <StrainRingStrip recovery={recovery} strainToday={null} wellness={wellness} activities={[]} maxHr={190} restingHr={50} />
  )
  expect(screen.getAllByText('—').length).toBeGreaterThan(0)
})
