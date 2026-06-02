import { render, screen } from '@testing-library/react'
import PlannedVsActualList from '@/components/PlannedVsActualList'
import type { AlignedSegment } from '@/lib/ride/planned-actual'

const segments: AlignedSegment[] = [
  { label: 'Warm Up', planned_pct: 60, planned_w: 150, actual_w: 165, start_frac: 0, width_frac: 0.5 }, // +10%
  { label: 'Effort', planned_pct: 100, planned_w: 250, actual_w: 240, start_frac: 0.5, width_frac: 0.5 }, // -4%
]

describe('PlannedVsActualList', () => {
  it('shows planned, actual, and signed delta per segment', () => {
    render(<PlannedVsActualList segments={segments} />)
    expect(screen.getByText('Warm Up')).toBeInTheDocument()
    expect(screen.getByText('165w')).toBeInTheDocument()
    expect(screen.getByText('+10%')).toBeInTheDocument()
    expect(screen.getByText('-4%')).toBeInTheDocument()
  })

  it('renders nothing for an empty list', () => {
    const { container } = render(<PlannedVsActualList segments={[]} />)
    expect(container.firstChild).toBeNull()
  })
})
