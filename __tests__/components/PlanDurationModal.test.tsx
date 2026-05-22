import { render, screen } from '@testing-library/react'
import PlanDurationModal from '@/components/PlanDurationModal'

describe('PlanDurationModal', () => {
  const noop = jest.fn()

  it('renders with empty notes by default', () => {
    render(<PlanDurationModal onStart={noop} onCancel={noop} />)
    const textarea = screen.getByRole('textbox')
    expect(textarea).toHaveValue('')
  })

  it('pre-fills notes when initialNotes is provided', () => {
    render(
      <PlanDurationModal
        onStart={noop}
        onCancel={noop}
        initialNotes="Just added Tour de France on 2026-07-04 — please revise the plan."
      />
    )
    const textarea = screen.getByRole('textbox')
    expect(textarea).toHaveValue('Just added Tour de France on 2026-07-04 — please revise the plan.')
  })
})
