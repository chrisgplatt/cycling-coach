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

test('passes a converted target range to the Strain ring as percentages', () => {
  // recovery.score=78 → computeStrainTarget(78) = { low: round(0.78*14)=11, high: 18 }
  // as percentages of 21: low 11/21*100≈52.38, high 18/21*100≈85.71
  render(
    <StrainRingStrip recovery={recovery} strainToday={strainToday} wellness={wellness} activities={[]} maxHr={190} restingHr={50} />
  )
  screen.getByRole('button', { name: /Strain breakdown/i }).closest('div') as HTMLElement
  // The two ticks render inside the Strain ring only — Recovery and Sleep rings get none.
  expect(screen.getAllByTestId('ring-tick-low')).toHaveLength(1)
  expect(screen.getAllByTestId('ring-tick-high')).toHaveLength(1)
})
