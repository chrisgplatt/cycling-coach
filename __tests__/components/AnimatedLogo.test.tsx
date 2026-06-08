import { render, screen } from '@testing-library/react'
import AnimatedLogo from '@/components/AnimatedLogo'

describe('AnimatedLogo', () => {
  it('renders the labelled logo at the requested size', () => {
    const { container } = render(<AnimatedLogo size={64} />)
    const svg = screen.getByRole('img', { name: 'My Cycling Coach' })
    expect(svg).toHaveAttribute('width', '64')
    expect(svg).toHaveAttribute('height', '64')
    // Two wheels, each with a spinning spoke group
    expect(container.querySelectorAll('.animate-spin')).toHaveLength(2)
  })

  it('holds the wheels still when spin is false', () => {
    const { container } = render(<AnimatedLogo spin={false} />)
    expect(container.querySelectorAll('.animate-spin')).toHaveLength(0)
  })

  it('drops the badge box and frames the bike tightly in bare mode', () => {
    const { container } = render(<AnimatedLogo bare />)
    expect(container.querySelector('rect')).toBeNull()
    expect(screen.getByRole('img', { name: 'My Cycling Coach' })).toHaveAttribute('viewBox', '-0.5 9 29 17.5')
  })
})
