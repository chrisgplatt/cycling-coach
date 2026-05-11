import { render, screen, fireEvent } from '@testing-library/react'
import ChatPanel from '@/components/ChatPanel'

describe('ChatPanel', () => {
  it('shows chat button on mobile (collapsed by default)', () => {
    render(<ChatPanel currentFTP={240} syncData={null} />)
    expect(screen.getByRole('button', { name: /chat/i })).toBeInTheDocument()
  })

  it('opens chat input when the chat button is clicked', () => {
    render(<ChatPanel currentFTP={240} syncData={null} />)
    fireEvent.click(screen.getByRole('button', { name: /chat/i }))
    expect(screen.getByRole('textbox')).toBeInTheDocument()
  })

  it('shows a welcome message', () => {
    render(<ChatPanel currentFTP={240} syncData={null} />)
    fireEvent.click(screen.getByRole('button', { name: /chat/i }))
    expect(screen.getByText(/how can I help/i)).toBeInTheDocument()
  })
})
