import { render, screen, act } from '@testing-library/react'
import SplashScreen from '@/components/SplashScreen'

describe('SplashScreen', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    sessionStorage.clear()
  })
  afterEach(() => {
    act(() => { jest.runOnlyPendingTimers() })
    jest.useRealTimers()
  })

  it('shows on a fresh app open then removes itself after the timers run', () => {
    render(<SplashScreen />)
    expect(screen.getByTestId('splash-screen')).toBeInTheDocument()
    expect(screen.getByText('My Cycling Coach')).toBeInTheDocument()

    act(() => { jest.advanceTimersByTime(2000) })
    expect(screen.queryByTestId('splash-screen')).not.toBeInTheDocument()
  })

  it('does not replay once it has been shown this session', () => {
    sessionStorage.setItem('cc_splash_shown', '1')
    render(<SplashScreen />)
    expect(screen.queryByTestId('splash-screen')).not.toBeInTheDocument()
  })
})
