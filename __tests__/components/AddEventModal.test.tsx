import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import AddEventModal from '@/components/AddEventModal'

function fillAndSave() {
  fireEvent.change(screen.getByPlaceholderText('e.g. Cheltenham Sportive'), { target: { value: 'Tour de France' } })
  fireEvent.change(document.querySelector('input[type="date"]') as HTMLInputElement, { target: { value: '2026-07-04' } })
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

  it('"Adapt plan" calls onRegenerate with event note then closes', async () => {
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
    fireEvent.click(screen.getByRole('button', { name: /adapt plan/i }))
    expect(onRegenerate).toHaveBeenCalledWith(
      expect.stringContaining('Tour de France')
    )
    expect(onRegenerate).toHaveBeenCalledWith(
      expect.stringContaining('2026-07-04')
    )
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('AddEventModal — holiday date range and continue training', () => {
  it('does not show End date or Continue training for a non-holiday type', () => {
    render(<AddEventModal onConfirm={jest.fn()} onClose={jest.fn()} />)
    expect(screen.queryByText('End date')).not.toBeInTheDocument()
    expect(screen.queryByText(/continue training/i)).not.toBeInTheDocument()
  })

  it('shows End date and Continue training once Holiday riding is selected', () => {
    render(<AddEventModal onConfirm={jest.fn()} onClose={jest.fn()} />)
    fireEvent.change(screen.getByDisplayValue('Sportive'), { target: { value: 'holiday' } })
    expect(screen.getByText('End date')).toBeInTheDocument()
    expect(screen.getByText(/continue training/i)).toBeInTheDocument()
  })

  it('saves end_date and continue_training for a holiday event', async () => {
    const onConfirm = jest.fn().mockResolvedValue(undefined)
    render(<AddEventModal onConfirm={onConfirm} onClose={jest.fn()} hasPlan={false} />)
    fireEvent.change(screen.getByPlaceholderText('e.g. Cheltenham Sportive'), { target: { value: 'Ski Trip' } })
    const dateInputs = document.querySelectorAll('input[type="date"]')
    fireEvent.change(dateInputs[0], { target: { value: '2026-08-10' } })
    fireEvent.change(screen.getByDisplayValue('Sportive'), { target: { value: 'holiday' } })
    fireEvent.change(screen.getByText('End date').closest('div')!.querySelector('input')!, { target: { value: '2026-08-17' } })
    fireEvent.click(screen.getByLabelText(/continue training/i))
    fireEvent.click(screen.getByRole('button', { name: /add event/i }))
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ end_date: '2026-08-17', continue_training: true })
    ))
  })
})
