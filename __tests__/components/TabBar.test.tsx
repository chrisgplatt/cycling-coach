import { render, screen, fireEvent } from '@testing-library/react'
import TabBar from '@/components/TabBar'

const tabs = [{ id: 'a', label: 'Overview' }, { id: 'b', label: 'Stats' }]

describe('TabBar', () => {
  it('renders a button per tab and reports selection', () => {
    const onSelect = jest.fn()
    render(<TabBar tabs={tabs} activeId="a" onSelect={onSelect} />)
    fireEvent.click(screen.getByRole('button', { name: 'Stats' }))
    expect(onSelect).toHaveBeenCalledWith('b')
  })

  it('marks the active tab with aria-selected', () => {
    render(<TabBar tabs={tabs} activeId="b" onSelect={() => {}} />)
    expect(screen.getByRole('button', { name: 'Stats' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('button', { name: 'Overview' })).toHaveAttribute('aria-selected', 'false')
  })
})
