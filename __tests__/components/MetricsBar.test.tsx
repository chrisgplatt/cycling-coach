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
      workout: 8.2,
      life: 3.1,
      total: 11,
      workoutLoad: 45,
      sleepScore: 72,
      sleepSecs: 25920, // 7.2h
      bodyBatteryHigh: 68,
    },
  ]

  it('shows the contributing-factor tooltip when a chart point is tapped', () => {
    render(<MetricsBar wellness={wellness} strainHistory={strainHistory} />)

    fireEvent.click(screen.getByText('Strain trend'))
    fireEvent.click(screen.getByTestId('strain-hit-6'))

    const tooltip = screen.getByTestId('strain-tooltip')
    expect(tooltip).toHaveTextContent('Sleep 72/100')
    expect(tooltip).toHaveTextContent('Duration 7.2h')
    expect(tooltip).toHaveTextContent('Peak battery 68%')
    expect(tooltip).toHaveTextContent('45 TSS')
    expect(tooltip).toHaveTextContent('Total 11/21')
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

describe('MetricsBar Wellbeing signal wiring', () => {
  const barebonesWellness: ICUWellness = {
    id: '2026-07-05', ctl: 65, atl: 72, form: -7, hrv: null, resting_hr: 52,
    sleep_secs: null, body_battery_low: null, body_battery_high: null,
    stress_avg: null, stress_high: null, garmin_training_load: null, sleep_score: null,
  }

  const suppressedHrvStatus: HrvStatus = {
    label: 'suppressed', sufficient: true, daysOfData: 60, today: 30, sevenDayAvg: 32,
    baselineMean: 60, lowerBound: 54, upperBound: 66, trend: 'falling', baselineDrift: 'stable',
  }

  it('feeds hrvStatus into the displayed strain score', () => {
    render(<MetricsBar wellness={barebonesWellness} hrvStatus={suppressedHrvStatus} />)
    // ratio 30/60=0.5 -> hrv index 0 -> raw=((100-0)/100)*2=2, avail=2 -> lifePts=(2/2)*7=7
    // workoutPts=0 (garmin_training_load null) -> total=round(0+7)=7
    expect(screen.getByText('7')).toBeInTheDocument()
  })

  it('feeds todayDailyWellness into the displayed strain score', () => {
    render(<MetricsBar wellness={barebonesWellness} todayDailyWellness={{ energy: 1, leg_freshness: 1 }} />)
    // energy=1,legs=1 -> avg=1 -> wellness index 0 -> raw=((100-0)/100)*1=1, avail=1 -> lifePts=(1/1)*7=7
    expect(screen.getByText('7')).toBeInTheDocument()
  })
})
