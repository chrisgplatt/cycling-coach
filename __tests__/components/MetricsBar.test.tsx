import { render, screen, fireEvent } from '@testing-library/react'
import MetricsBar from '@/components/MetricsBar'
import type { ICUWellness, DailyStrainPoint } from '@/types'
import type { HrvStatus } from '@/lib/hrv/baseline'

const wellness: ICUWellness = {
  id: '2026-05-11', ctl: 65, atl: 72, form: -7, hrv: 68, resting_hr: 52, sleep_secs: 28800, body_battery_low: null, body_battery_high: null, stress_avg: null, stress_high: null, garmin_training_load: null, sleep_score: null,
}

describe('MetricsBar', () => {
  it('displays CTL, ATL, and form values', () => {
    render(<MetricsBar wellness={wellness} />)
    expect(screen.getByText('65')).toBeInTheDocument()
    expect(screen.getByText('72')).toBeInTheDocument()
    expect(screen.getByText('-7')).toBeInTheDocument()
  })

  it('renders gracefully with null values', () => {
    render(<MetricsBar wellness={{ ...wellness, ctl: null, atl: null, form: null }} />)
    expect(screen.getAllByText('—')).toHaveLength(3)
  })
})

describe('MetricsBar strain trend tooltip', () => {
  // The 1W tab renders 7 days ending today, so "today" is always index 6 —
  // computed locally (not via toISOString) to match the component's local-date bucketing.
  function localToday(): string {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }

  const strainHistory: DailyStrainPoint[] = [
    {
      date: localToday(),
      dailyTrimp: 120,
      trimpRef: 150,
      workoutStrain: 11,
      garminReadiness: null,
      garminRecoveryTimeMins: null,
      garminBatteryCharged: null,
      garminBatteryDrained: null,
      garminStressMax: null,
    },
  ]

  it('shows the strain value in the tooltip when a chart point is tapped', () => {
    render(<MetricsBar wellness={wellness} strainHistory={strainHistory} />)

    fireEvent.click(screen.getByText('Strain trend'))
    fireEvent.click(screen.getByTestId('strain-hit-6'))

    const tooltip = screen.getByTestId('strain-tooltip')
    expect(tooltip).toHaveTextContent('Strain 11/21')
  })

  it('closes the tooltip when the same point is tapped again', () => {
    render(<MetricsBar wellness={wellness} strainHistory={strainHistory} />)

    fireEvent.click(screen.getByText('Strain trend'))
    const point = screen.getByTestId('strain-hit-6')

    fireEvent.click(point)
    expect(screen.getByTestId('strain-tooltip')).toBeInTheDocument()

    fireEvent.click(point)
    expect(screen.queryByTestId('strain-tooltip')).not.toBeInTheDocument()
  })
})

describe('MetricsBar strain band', () => {
  const barebonesWellness: ICUWellness = {
    id: '2026-07-05', ctl: 65, atl: 72, form: -7, hrv: null, resting_hr: 52,
    sleep_secs: null, body_battery_low: null, body_battery_high: null,
    stress_avg: null, stress_high: null, garmin_training_load: null, sleep_score: null,
  }

  const suppressedHrvStatus: HrvStatus = {
    label: 'suppressed', sufficient: true, daysOfData: 60, today: 30, sevenDayAvg: 32,
    baselineMean: 60, lowerBound: 54, upperBound: 66, trend: 'falling', baselineDrift: 'stable',
  }

  function strainPoint(workoutStrain: number): DailyStrainPoint {
    return {
      date: '2026-07-05',
      dailyTrimp: 0,
      trimpRef: 150,
      workoutStrain,
      garminReadiness: null,
      garminRecoveryTimeMins: null,
      garminBatteryCharged: null,
      garminBatteryDrained: null,
      garminStressMax: null,
    }
  }

  it('reads the strain score from the strainToday prop, not from wellness/hrv', () => {
    render(<MetricsBar wellness={barebonesWellness} hrvStatus={suppressedHrvStatus} strainToday={strainPoint(7)} />)
    expect(screen.getByText('7')).toBeInTheDocument()
    expect(screen.getByText('Light')).toBeInTheDocument()
  })

  it('shows the "Moderate" band label for a mid-range score', () => {
    render(<MetricsBar wellness={barebonesWellness} strainToday={strainPoint(11)} />)
    expect(screen.getByText('Moderate')).toBeInTheDocument()
  })

  it('shows the "High" band label for a high score', () => {
    render(<MetricsBar wellness={barebonesWellness} strainToday={strainPoint(15)} />)
    expect(screen.getByText('High')).toBeInTheDocument()
  })

  it('shows the "All Out" band label for a max score', () => {
    render(<MetricsBar wellness={barebonesWellness} strainToday={strainPoint(19)} />)
    expect(screen.getByText('All Out')).toBeInTheDocument()
  })
})
