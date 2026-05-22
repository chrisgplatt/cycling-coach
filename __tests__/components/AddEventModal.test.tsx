import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import AddEventModal from '@/components/AddEventModal'

function fillAndSave() {
  fireEvent.change(screen.getByPlaceholderText('Event name'), { target: { value: 'Tour de France' } })
  fireEvent.change(screen.getByDisplayValue(''), { target: { value: '2026-07-04' } })
  fireEvent.click(screen.getByRole('button', { name: /add event/i }))
}

describe('AddEventModal — no plan', () => {
  it('closes immediately after save when hasPlan is false', async () => {
    const onConfirm = jest.fn().mockResolvedValue(undefined)
    const onClose = jest.fn()
    render(
      <AddEventModal
        onConfirm={onConfirm}
        onClose={onClose}
        hasPlan={false}
      />
    )
    fillAndSave()
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(screen.queryByText(/regenerate/i)).not.toBeInTheDocument()
  })

  it('closes immediately after save when onRegenerate is not provided', async () => {
    const onConfirm = jest.fn().mockResolvedValue(undefined)
    const onClose = jest.fn()
    render(
      <AddEventModal
        onConfirm={onConfirm}
        onClose={onClose}
        hasPlan={true}
      />
    )
    fillAndSave()
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })
})

describe('AddEventModal — with plan', () => {
  it('shows saved prompt after save when hasPlan and onRegenerate are provided', async () => {
    const onConfirm = jest.fn().mockResolvedValue(undefined)
    const onClose = jest.fn()
    const onRegenerate = jest.fn()
    render(
      <AddEventModal
        onConfirm={onConfirm}
        onClose={onClose}
        hasPlan={true}
        onRegenerate={onRegenerate}
      />
    )
    fillAndSave()
    await waitFor(() => expect(screen.getByText(/event saved/i)).toBeInTheDocument())
    expect(onClose).not.toHaveBeenCalled()
  })

  it('"Not now" closes the modal', async () => {
    const onConfirm = jest.fn().mockResolvedValue(undefined)
    const onClose = jest.fn()
    const onRegenerate = jest.fn()
    render(
      <AddEventModal
        onConfirm={onConfirm}
        onClose={onClose}
        hasPlan={true}
        onRegenerate={onRegenerate}
      />
    )
    fillAndSave()
    await waitFor(() => screen.getByText(/event saved/i))
    fireEvent.click(screen.getByRole('button', { name: /not now/i }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onRegenerate).not.toHaveBeenCalled()
  })

  it('"Regenerate plan" calls onRegenerate with event note then closes', async () => {
    const onConfirm = jest.fn().mockResolvedValue(undefined)
    const onClose = jest.fn()
    const onRegenerate = jest.fn()
    render(
      <AddEventModal
        onConfirm={onConfirm}
        onClose={onClose}
        hasPlan={true}
        onRegenerate={onRegenerate}
      />
    )
    fillAndSave()
    await waitFor(() => screen.getByText(/event saved/i))
    fireEvent.click(screen.getByRole('button', { name: /regenerate plan/i }))
    expect(onRegenerate).toHaveBeenCalledWith(
      expect.stringContaining('Tour de France')
    )
    expect(onRegenerate).toHaveBeenCalledWith(
      expect.stringContaining('2026-07-04')
    )
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
