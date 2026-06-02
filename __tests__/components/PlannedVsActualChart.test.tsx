import { render } from '@testing-library/react'
import PlannedVsActualChart from '@/components/PlannedVsActualChart'
import type { PlannedActual } from '@/lib/ride/planned-actual'

const base: PlannedActual = {
  segments: [
    { label: 'Warm Up', planned_pct: 60, planned_w: 150, actual_w: 148, start_frac: 0, width_frac: 0.5 },
    { label: 'Effort', planned_pct: 100, planned_w: 250, actual_w: 252, start_frac: 0.5, width_frac: 0.5 },
  ],
  trace: [{ x: 0, pct: 60 }, { x: 0.5, pct: 60 }, { x: 0.5, pct: 100 }, { x: 1, pct: 100 }],
  aligned: 'laps',
  yMaxPct: 110,
}

describe('PlannedVsActualChart', () => {
  it('renders one bar per segment and an actual-power polyline', () => {
    const { container } = render(<PlannedVsActualChart data={base} ftp={250} />)
    expect(container.querySelectorAll('rect').length).toBe(2)
    expect(container.querySelector('polyline')).toBeTruthy()
  })

  it('shows the approximate-alignment note only when scaled', () => {
    const { queryByText, rerender } = render(<PlannedVsActualChart data={base} ftp={250} />)
    expect(queryByText(/approximate alignment/i)).toBeNull()
    rerender(<PlannedVsActualChart data={{ ...base, aligned: 'scaled' }} ftp={250} />)
    expect(queryByText(/approximate alignment/i)).toBeInTheDocument()
  })
})
