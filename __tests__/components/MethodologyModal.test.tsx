import { render, screen, fireEvent } from '@testing-library/react'
import MethodologyModal from '@/components/MethodologyModal'
import type { TrainingPhilosophy } from '@/types'

const recommendation: TrainingPhilosophy = {
  name: 'friel-polarised-base',
  label: 'Friel periodization · polarised base',
  phase_weeks: { base: 4, build: 5, peak: 1, taper: 2 },
  intensity_profile: 'polarised-base',
  weekly_hours_at_creation: 9,
  rationale: 'Based on your 9.0h/week schedule and a sportive in 12 weeks.',
}

const onConfirm = jest.fn()
const onClose = jest.fn()

beforeEach(() => { onConfirm.mockReset(); onClose.mockReset() })

describe('MethodologyModal', () => {
  it('renders the label and rationale', () => {
    render(<MethodologyModal recommendation={recommendation} onConfirm={onConfirm} onClose={onClose} />)
    expect(screen.getByText('Friel periodization · polarised base')).toBeInTheDocument()
    expect(screen.getByText(/9.0h\/week/)).toBeInTheDocument()
  })

  it('renders phase breakdown', () => {
    render(<MethodologyModal recommendation={recommendation} onConfirm={onConfirm} onClose={onClose} />)
    expect(screen.getByText('Base')).toBeInTheDocument()
    expect(screen.getByText('Build')).toBeInTheDocument()
    expect(screen.getByText('Taper')).toBeInTheDocument()
  })

  it('"Use this approach" calls onConfirm with original recommendation', () => {
    render(<MethodologyModal recommendation={recommendation} onConfirm={onConfirm} onClose={onClose} />)
    fireEvent.click(screen.getByText('Use this approach'))
    expect(onConfirm).toHaveBeenCalledWith(recommendation)
  })

  it('"More intensity" calls onConfirm with threshold-heavy profile', () => {
    render(<MethodologyModal recommendation={recommendation} onConfirm={onConfirm} onClose={onClose} />)
    fireEvent.click(screen.getByText(/More intensity/))
    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ intensity_profile: 'threshold-heavy' })
    )
  })

  it('"Keep it simpler" calls onConfirm with simplified profile', () => {
    render(<MethodologyModal recommendation={recommendation} onConfirm={onConfirm} onClose={onClose} />)
    fireEvent.click(screen.getByText(/Keep it simpler/))
    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ intensity_profile: 'simplified' })
    )
  })

  it('backdrop click calls onClose', () => {
    render(<MethodologyModal recommendation={recommendation} onConfirm={onConfirm} onClose={onClose} />)
    fireEvent.click(document.querySelector('.bg-black\\/40')!)
    expect(onClose).toHaveBeenCalled()
  })

  it('does not render Peak row when peak weeks is 0', () => {
    const noPeak = { ...recommendation, phase_weeks: { base: 1, build: 2, peak: 0, taper: 1 } }
    render(<MethodologyModal recommendation={noPeak} onConfirm={onConfirm} onClose={onClose} />)
    expect(screen.queryByText('Peak')).not.toBeInTheDocument()
  })
})
