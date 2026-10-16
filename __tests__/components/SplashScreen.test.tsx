import { render, screen, act } from '@testing-library/react'
import SplashScreen from '@/components/SplashScreen'

describe('SplashScreen', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    sessionStorage.clear()
  })
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_APP_VERSION
    delete process.env.NEXT_PUBLIC_BUILD_DATE
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

  it('shows the app version and build date at the bottom of the splash', () => {
    process.env.NEXT_PUBLIC_APP_VERSION = '1.0.0'
    process.env.NEXT_PUBLIC_BUILD_DATE = '2026-10-16T15:49:00.000Z'
    render(<SplashScreen />)
    expect(screen.getByTestId('splash-build-info')).toHaveTextContent(/^v1\.0\.0 · Built 1\d Oct 2026/)
  })

  it('omits the build line when neither value is available', () => {
    delete process.env.NEXT_PUBLIC_APP_VERSION
    delete process.env.NEXT_PUBLIC_BUILD_DATE
    render(<SplashScreen />)
    expect(screen.getByTestId('splash-screen')).toBeInTheDocument()
    expect(screen.queryByTestId('splash-build-info')).not.toBeInTheDocument()
  })

  it('does not replay once it has been shown this session', () => {
    sessionStorage.setItem('cc_splash_shown', '1')
    render(<SplashScreen />)
    expect(screen.queryByTestId('splash-screen')).not.toBeInTheDocument()
  })
})
