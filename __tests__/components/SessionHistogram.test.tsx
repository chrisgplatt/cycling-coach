import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SessionHistogram from '@/components/SessionHistogram'
import type { SessionDistributions } from '@/types'

const full: SessionDistributions = {
  power: [{ edge: 50, secs: 300 }, { edge: 100, secs: 900 }],
  power_vi: 1.12, power_steady_pct: 40,
  cadence: [{ edge: 80, secs: 600 }, { edge: 90, secs: 600 }],
  coasting_secs: 120,
  hr: [{ edge: 140, secs: 500 }, { edge: 160, secs: 300 }],
  hr_lthr: 158,
}

describe('SessionHistogram', () => {
  it('renders nothing when distributions is null', () => {
    const { container } = render(<SessionHistogram distributions={null} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows only tabs that have data', () => {
    render(<SessionHistogram distributions={{ ...full, cadence: null, hr: null }} />)
    expect(screen.getByRole('button', { name: /power/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /cadence/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /hr/i })).toBeNull()
  })

  it('defaults to the power chart and shows its summary line', () => {
    render(<SessionHistogram distributions={full} />)
    expect(screen.getByText(/VI 1.12/)).toBeInTheDocument()
    expect(screen.getByText(/40% within ±5% NP/)).toBeInTheDocument()
  })

  it('labels the y-axis (peak time) and x-axis (data range) for the power chart', () => {
    render(<SessionHistogram distributions={full} />)
    expect(screen.getByText('15m')).toBeInTheDocument()   // peak bin: 900s
    expect(screen.getByText('0')).toBeInTheDocument()      // y baseline
    expect(screen.getByText('50%')).toBeInTheDocument()    // first edge
    expect(screen.getByText('105%')).toBeInTheDocument()   // last edge + 5% width
  })

  it('switches to cadence when its tab is pressed', async () => {
    render(<SessionHistogram distributions={full} />)
    await userEvent.click(screen.getByRole('button', { name: /cadence/i }))
    expect(screen.getByText(/Coasted 2 min/)).toBeInTheDocument()
  })

  it('shows the LTHR summary on the HR tab (zone-overlaid)', async () => {
    render(<SessionHistogram distributions={full} />)
    await userEvent.click(screen.getByRole('button', { name: /hr/i }))
    expect(screen.getByText(/LTHR 158 bpm/)).toBeInTheDocument()
  })
})
