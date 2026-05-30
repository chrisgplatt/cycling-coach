import { render, screen, fireEvent } from '@testing-library/react'
import CoachChat from '@/components/CoachChat'

describe('CoachChat', () => {
  it('shows a welcome message and an input', () => {
    render(<CoachChat currentFTP={240} onClose={() => {}} />)
    expect(screen.getByText(/how can I help/i)).toBeInTheDocument()
    expect(screen.getByRole('textbox')).toBeInTheDocument()
  })

  it('calls onClose when the close button is clicked', () => {
    const onClose = jest.fn()
    render(<CoachChat currentFTP={240} onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: /close/i }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
