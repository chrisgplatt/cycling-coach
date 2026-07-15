import { render, screen, fireEvent } from '@testing-library/react'
import HrvChart from '@/components/HrvChart'
import type { ICUWellness } from '@/types'

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 864e5).toISOString().split('T')[0]
}

function makeWellness(n: number): ICUWellness[] {
  return Array.from({ length: n }, (_, i) => ({
    id: daysAgo(n - 1 - i), ctl: null, atl: null, form: null, hrv: 50 + i, resting_hr: null,
    sleep_secs: null, body_battery_low: null, body_battery_high: null, stress_avg: null,
    stress_high: null, garmin_training_load: null, sleep_score: null,
  }))
}

describe('HrvChart', () => {
  it('renders the HRV status header and one dot per day when data is present', () => {
    const { container } = render(<HrvChart wellness={makeWellness(10)} />)
    // 10 days of data is below the 14-reading minimum computeHrvBaseline needs
    // for a suppressed/balanced/elevated verdict, so it reports "building baseline".
    expect(screen.getByText('Building baseline')).toBeInTheDocument()
    expect(container.querySelectorAll('circle').length).toBe(10)
  })

  it('shows the "no data in this range" fallback when the wellness array is empty', () => {
    render(<HrvChart wellness={[]} />)
    expect(screen.getByText('No HRV data in this range.')).toBeInTheDocument()
  })

  it('narrows the visible points when a shorter range button is clicked', () => {
    const { container } = render(<HrvChart wellness={makeWellness(10)} />)
    expect(container.querySelectorAll('circle').length).toBe(10)

    fireEvent.click(screen.getByText('1w'))
    expect(container.querySelectorAll('circle').length).toBeLessThan(10)
  })

  it('uses defaultRangeDays for the initial visible window', () => {
    const { container } = render(<HrvChart wellness={makeWellness(10)} defaultRangeDays={7} />)
    // Same 10-day fixture as above, but starting on the 7-day range instead of the
    // default 91-day range should exclude the two oldest points from the start.
    expect(container.querySelectorAll('circle').length).toBeLessThan(10)
  })

  it('shows a tooltip with the date and exact HRV value when a point is tapped', () => {
    render(<HrvChart wellness={makeWellness(10)} />)
    fireEvent.click(screen.getByTestId('hrv-hit-9')) // most recent day, hrv = 59

    const tooltip = screen.getByTestId('hrv-tooltip')
    expect(tooltip).toHaveTextContent('59ms')
  })

  it('closes the tooltip when the same point is tapped again', () => {
    render(<HrvChart wellness={makeWellness(10)} />)
    const point = screen.getByTestId('hrv-hit-9')

    fireEvent.click(point)
    expect(screen.getByTestId('hrv-tooltip')).toBeInTheDocument()

    fireEvent.click(point)
    expect(screen.queryByTestId('hrv-tooltip')).not.toBeInTheDocument()
  })

  it('resets the open tooltip when the range changes', () => {
    render(<HrvChart wellness={makeWellness(10)} />)
    fireEvent.click(screen.getByTestId('hrv-hit-9'))
    expect(screen.getByTestId('hrv-tooltip')).toBeInTheDocument()

    fireEvent.click(screen.getByText('1w'))
    expect(screen.queryByTestId('hrv-tooltip')).not.toBeInTheDocument()
  })
})
