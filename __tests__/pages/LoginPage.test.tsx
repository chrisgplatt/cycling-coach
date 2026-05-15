import { render, screen } from '@testing-library/react'
import LoginPage from '@/app/login/page'

jest.mock('next/navigation', () => ({
  useSearchParams: jest.fn(() => new URLSearchParams()),
  useRouter: jest.fn(),
}))

jest.mock('@/lib/supabase-browser', () => ({
  createSupabaseBrowserClient: () => ({
    auth: { signInWithOAuth: jest.fn() },
  }),
}))

afterEach(() => jest.restoreAllMocks())

describe('LoginPage', () => {
  it('renders a Sign in with Google button', async () => {
    render(<LoginPage />)
    expect(await screen.findByRole('button', { name: /sign in with google/i })).toBeInTheDocument()
  })

  it('does not show an error by default', async () => {
    render(<LoginPage />)
    expect(screen.queryByText(/hasn't been invited/i)).not.toBeInTheDocument()
  })

  it('shows not-invited error when error=not_invited is in the URL', async () => {
    const { useSearchParams } = require('next/navigation')
    useSearchParams.mockReturnValue(new URLSearchParams('error=not_invited'))
    render(<LoginPage />)
    expect(await screen.findByText(/hasn't been invited yet/i)).toBeInTheDocument()
  })
})
