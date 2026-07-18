import { render, screen, fireEvent } from '@testing-library/react'
import MetricsBar from '@/components/MetricsBar'
import type { ICUWellness, DailyStrainPoint } from '@/types'

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
