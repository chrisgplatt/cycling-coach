import { render, screen } from '@testing-library/react'
import { usePathname } from 'next/navigation'
import NavBar from '@/components/NavBar'

jest.mock('next/navigation', () => ({ usePathname: jest.fn() }))
jest.mock('@/components/SignOutButton', () => () => <button>Sign out</button>)

describe('NavBar', () => {
  beforeEach(() => { (usePathname as jest.Mock).mockReturnValue('/dashboard') })

  it('renders a Plan link pointing to /plan', () => {
    render(<NavBar />)
    expect(screen.getByRole('link', { name: 'Plan' })).toHaveAttribute('href', '/plan')
  })

  it('renders Account link pointing to /settings', () => {
    render(<NavBar />)
    expect(screen.getByRole('link', { name: 'Account' })).toHaveAttribute('href', '/settings')
  })

  it('does not render a Settings link', () => {
    render(<NavBar />)
    expect(screen.queryByRole('link', { name: 'Settings' })).not.toBeInTheDocument()
  })

  it('highlights Plan link when on /plan', () => {
    (usePathname as jest.Mock).mockReturnValue('/plan')
    render(<NavBar />)
    expect(screen.getByRole('link', { name: 'Plan' }).className).toMatch(/border-blue-600/)
  })

  it('renders Stats link pointing to /stats', () => {
    render(<NavBar />)
    expect(screen.getByRole('link', { name: 'Stats' })).toHaveAttribute('href', '/stats')
  })
})
