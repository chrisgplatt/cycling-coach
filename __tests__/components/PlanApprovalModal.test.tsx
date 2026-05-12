import { render, screen } from '@testing-library/react'
import PlanApprovalModal from '@/components/PlanApprovalModal'
import type { GeneratedPlan } from '@/types'

const plan: GeneratedPlan = {
  rationale: 'First paragraph.\n\nSecond paragraph.',
  target_event_name: 'Gran Fondo',
  target_event_date: '2026-09-01',
  phase: 'base',
  workouts: [],
}

describe('PlanApprovalModal', () => {
  it('renders rationale as separate paragraphs', () => {
    render(<PlanApprovalModal plan={plan} onApprove={jest.fn()} onReject={jest.fn()} />)
    expect(screen.getByText('First paragraph.')).toBeInTheDocument()
    expect(screen.getByText('Second paragraph.')).toBeInTheDocument()
  })
})
