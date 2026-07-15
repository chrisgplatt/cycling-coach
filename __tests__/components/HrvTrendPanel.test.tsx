import { render, screen, fireEvent } from '@testing-library/react'
import HrvTrendPanel from '@/components/HrvTrendPanel'
import type { ICUWellness } from '@/types'

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 864e5).toISOString().split('T')[0]
}

function makeWellnessHistory(n: number): ICUWellness[] {
  return Array.from({ length: n }, (_, i) => ({
    id: daysAgo(n - 1 - i), ctl: null, atl: null, form: null, hrv: 50 + i, resting_hr: null,
    sleep_secs: null, body_battery_low: null, body_battery_high: null, stress_avg: null,
    stress_high: null, garmin_training_load: null, sleep_score: null,
  }))
}

describe('HrvTrendPanel', () => {
  it('renders nothing when there is no HRV history', () => {
    const { container } = render(<HrvTrendPanel wellness={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the HRV trend toggle and expands the chart on tap', () => {
    render(<HrvTrendPanel wellness={makeWellnessHistory(10)} />)
    expect(screen.getByText('HRV trend')).toBeInTheDocument()
    expect(screen.queryByText('Building baseline')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('HRV trend'))
    expect(screen.getByText('Building baseline')).toBeInTheDocument()
  })
})
