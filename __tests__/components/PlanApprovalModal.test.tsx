import { render, screen, fireEvent } from '@testing-library/react'
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

  it('renders plan name input', () => {
    render(<PlanApprovalModal plan={plan} onApprove={jest.fn()} onReject={jest.fn()} />)
    expect(screen.getByPlaceholderText(/e\.g\. base block 1/i)).toBeInTheDocument()
  })

  it('disables Approve button when name is empty', () => {
    render(<PlanApprovalModal plan={plan} onApprove={jest.fn()} onReject={jest.fn()} />)
    expect(screen.getByRole('button', { name: /approve/i })).toBeDisabled()
  })

  it('enables Approve button when name is typed', () => {
    render(<PlanApprovalModal plan={plan} onApprove={jest.fn()} onReject={jest.fn()} />)
    fireEvent.change(screen.getByPlaceholderText(/e\.g\. base block 1/i), { target: { value: 'Base Block 1' } })
    expect(screen.getByRole('button', { name: /approve/i })).not.toBeDisabled()
  })

  it('sends name in PATCH body on approve', () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({}) })
    render(<PlanApprovalModal plan={plan} onApprove={jest.fn()} onReject={jest.fn()} />)
    fireEvent.change(screen.getByPlaceholderText(/e\.g\. base block 1/i), { target: { value: 'Base Block 1' } })
    fireEvent.click(screen.getByRole('button', { name: /approve/i }))
    expect(global.fetch).toHaveBeenCalledWith('/api/plan', expect.objectContaining({
      method: 'PATCH',
      body: expect.stringContaining('"name":"Base Block 1"'),
    }))
  })
})
