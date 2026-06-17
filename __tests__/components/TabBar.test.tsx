import { render, screen, fireEvent } from '@testing-library/react'
import TabBar from '@/components/TabBar'

const tabs = [{ id: 'a', label: 'Overview' }, { id: 'b', label: 'Stats' }]

describe('TabBar', () => {
  it('renders a button per tab and reports selection', () => {
    const onSelect = jest.fn()
    render(<TabBar tabs={tabs} activeId="a" onSelect={onSelect} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Stats' }))
    expect(onSelect).toHaveBeenCalledWith('b')
  })

  it('marks the active tab with aria-selected', () => {
    render(<TabBar tabs={tabs} activeId="b" onSelect={() => {}} />)
    expect(screen.getByRole('tab', { name: 'Stats' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'false')
  })

  it('renders an amber dot when dot: true is set on a tab', () => {
    const tabsWithDot = [
      { id: 'a', label: 'Overview' },
      { id: 'b', label: 'Feedback', dot: true },
    ]
    render(<TabBar tabs={tabsWithDot} activeId="a" onSelect={() => {}} />)
    expect(screen.getByTestId('tab-dot-b')).toBeInTheDocument()
  })

  it('does not render a dot when dot is omitted or false', () => {
    const tabsNoDot = [
      { id: 'a', label: 'Overview' },
      { id: 'b', label: 'Feedback' },
    ]
    render(<TabBar tabs={tabsNoDot} activeId="a" onSelect={() => {}} />)
    expect(screen.queryByTestId('tab-dot-b')).not.toBeInTheDocument()
  })
})
