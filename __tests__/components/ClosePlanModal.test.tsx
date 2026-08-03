import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import ClosePlanModal from '@/components/ClosePlanModal'

describe('ClosePlanModal', () => {
  it('shows the close-plan confirmation copy', () => {
    render(<ClosePlanModal onConfirm={jest.fn()} onClose={jest.fn()} />)
    expect(screen.getByText('Close plan?')).toBeInTheDocument()
    expect(screen.getByText(/saves its stats to your plan history/)).toBeInTheDocument()
  })

  it('calls onConfirm and shows the result on "Yes, close"', async () => {
    const onConfirm = jest.fn().mockResolvedValue('Plan closed and saved to history. 3 workouts removed.')
    render(<ClosePlanModal onConfirm={onConfirm} onClose={jest.fn()} />)

    fireEvent.click(screen.getByText('Yes, close'))
    expect(screen.getByText('Closing plan…')).toBeInTheDocument()

    await waitFor(() => expect(screen.getByText(/3 workouts removed/)).toBeInTheDocument())
    expect(onConfirm).toHaveBeenCalled()
  })

  it('calls onClose from the cancel button', () => {
    const onClose = jest.fn()
    render(<ClosePlanModal onConfirm={jest.fn()} onClose={onClose} />)
    fireEvent.click(screen.getByText('Cancel'))
    expect(onClose).toHaveBeenCalled()
  })
})
