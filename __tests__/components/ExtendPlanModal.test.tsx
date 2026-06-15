import { render, screen, fireEvent } from '@testing-library/react'
import ExtendPlanModal from '@/components/ExtendPlanModal'
import type { TrainingEvent, TrainingPhilosophy } from '@/types'

const philosophy: TrainingPhilosophy = {
  name: 'friel-polarised-base',
  label: 'Friel periodization · polarised base',
  phase_weeks: { base: 4, build: 5, peak: 1, taper: 2 },
  intensity_profile: 'polarised-base',
  weekly_hours_at_creation: 9,
  rationale: 'Based on your 9.0h/week schedule.',
}

const eventA: TrainingEvent = {
  name: 'Dragon Ride',
  date: '2026-09-14',
  type: 'sportive',
  priority: 'A',
}

const eventC: TrainingEvent = {
  name: 'Club Ride',
  date: '2026-09-14',
  type: 'sportive',
  priority: 'C',
}

const baseProps = {
  planEndDate: '2026-08-22',
  planCreatedAt: '2026-06-01T00:00:00Z',
  planWeeks: 12,
  currentPhilosophy: philosophy,
  weeklyHours: 9,
  events: [],
  currentCTL: 55,
  onConfirm: jest.fn(),
  onClose: jest.fn(),
}

beforeEach(() => {
  baseProps.onConfirm.mockReset()
  baseProps.onClose.mockReset()
})

describe('ExtendPlanModal — no events', () => {
  it('renders header and week chips', () => {
    render(<ExtendPlanModal {...baseProps} />)
    expect(screen.getByText('Extend plan')).toBeInTheDocument()
    expect(screen.getByText('When do you want to extend to?')).toBeInTheDocument()
    expect(screen.getByText('+2')).toBeInTheDocument()
    expect(screen.getByText('+4')).toBeInTheDocument()
    expect(screen.getByText('+6')).toBeInTheDocument()
    expect(screen.getByText('+8')).toBeInTheDocument()
  })

  it('calls onConfirm with 2 by default', () => {
    render(<ExtendPlanModal {...baseProps} />)
    fireEvent.click(screen.getByRole('button', { name: /extend plan by 2/i }))
    expect(baseProps.onConfirm).toHaveBeenCalledWith(2)
  })

  it('calls onConfirm with 4 after selecting +4', () => {
    render(<ExtendPlanModal {...baseProps} />)
    fireEvent.click(screen.getByText('+4'))
    fireEvent.click(screen.getByRole('button', { name: /extend plan by 4/i }))
    expect(baseProps.onConfirm).toHaveBeenCalledWith(4)
  })

  it('calls onClose when cancel is clicked', () => {
    render(<ExtendPlanModal {...baseProps} />)
    fireEvent.click(screen.getByText('Cancel'))
    expect(baseProps.onClose).toHaveBeenCalled()
  })
})

describe('ExtendPlanModal — with events', () => {
  it('renders event rows alongside week chips', () => {
    render(<ExtendPlanModal {...baseProps} events={[eventC]} />)
    expect(screen.getByText('Club Ride')).toBeInTheDocument()
    expect(screen.getByText('+2')).toBeInTheDocument()
  })

  it('selecting an event row updates the CTA label', () => {
    render(<ExtendPlanModal {...baseProps} events={[eventC]} />)
    fireEvent.click(screen.getByText('Club Ride'))
    expect(screen.getByRole('button', { name: /extend to Club Ride/i })).toBeInTheDocument()
  })

  it('calls onConfirm with computed weeks when event row selected', () => {
    render(<ExtendPlanModal {...baseProps} events={[eventC]} />)
    fireEvent.click(screen.getByText('Club Ride'))
    fireEvent.click(screen.getByRole('button', { name: /extend to Club Ride/i }))
    // weeksFromPlanEnd('2026-09-14', '2026-08-22') = ceil(23/7) = 4
    expect(baseProps.onConfirm).toHaveBeenCalledWith(4)
  })

  it('pre-selects nearest A/B event and shows event CTA', () => {
    render(<ExtendPlanModal {...baseProps} events={[eventA]} />)
    expect(screen.getByText('Dragon Ride')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /extend to Dragon Ride/i })).toBeInTheDocument()
  })

  it('calls onConfirm with pre-selected A event weeks', () => {
    render(<ExtendPlanModal {...baseProps} events={[eventA]} />)
    fireEvent.click(screen.getByRole('button', { name: /extend to Dragon Ride/i }))
    expect(baseProps.onConfirm).toHaveBeenCalledWith(4)
  })
})
