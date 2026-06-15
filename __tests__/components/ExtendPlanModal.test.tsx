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

// A-priority event beyond plan end → triggers event mode
const eventA: TrainingEvent = {
  name: 'Dragon Ride',
  date: '2026-09-14',
  type: 'sportive',
  priority: 'A',
}

// C-priority events → appear as selectable rows in manual mode only
const eventC1: TrainingEvent = {
  name: 'Club Ride',
  date: '2026-09-14',
  type: 'sportive',
  priority: 'C',
}

const eventC2: TrainingEvent = {
  name: 'Mallorca Camp',
  date: '2026-11-01',
  type: 'holiday',
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

describe('ExtendPlanModal — manual mode (no events)', () => {
  it('renders the header', () => {
    render(<ExtendPlanModal {...baseProps} />)
    expect(screen.getByText('Extend plan')).toBeInTheDocument()
    expect(screen.getByText('When do you want to extend to?')).toBeInTheDocument()
  })

  it('renders week chips', () => {
    render(<ExtendPlanModal {...baseProps} />)
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

describe('ExtendPlanModal — manual mode with C-priority events', () => {
  it('renders upcoming event rows', () => {
    render(<ExtendPlanModal {...baseProps} events={[eventC1, eventC2]} />)
    expect(screen.getByText('Club Ride')).toBeInTheDocument()
    expect(screen.getByText('Mallorca Camp')).toBeInTheDocument()
  })

  it('selecting an event row updates the CTA label', () => {
    render(<ExtendPlanModal {...baseProps} events={[eventC1]} />)
    fireEvent.click(screen.getByText('Club Ride'))
    expect(screen.getByRole('button', { name: /extend to Club Ride/i })).toBeInTheDocument()
  })

  it('calls onConfirm with computed weeks when an event row is selected', () => {
    render(<ExtendPlanModal {...baseProps} events={[eventC1]} />)
    fireEvent.click(screen.getByText('Club Ride'))
    fireEvent.click(screen.getByRole('button', { name: /extend to Club Ride/i }))
    // weeksFromPlanEnd('2026-09-14', '2026-08-22') = ceil(23/7) = 4
    expect(baseProps.onConfirm).toHaveBeenCalledWith(4)
  })
})

describe('ExtendPlanModal — event mode (A/B event beyond plan end)', () => {
  it('renders event name and suggested weeks CTA', () => {
    render(<ExtendPlanModal {...baseProps} events={[eventA]} />)
    expect(screen.getByText(/Dragon Ride moved/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /extend to/i })).toBeInTheDocument()
  })

  it('calls onConfirm with suggestedWeeks when event is present', () => {
    render(<ExtendPlanModal {...baseProps} events={[eventA]} />)
    fireEvent.click(screen.getByRole('button', { name: /extend to/i }))
    // suggestedWeeks = ceil((14 Sep - 22 Aug) / 7) = ceil(23/7) = 4
    expect(baseProps.onConfirm).toHaveBeenCalledWith(4)
  })
})
