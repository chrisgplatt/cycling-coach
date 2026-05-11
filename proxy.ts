import { NextRequest, NextResponse } from 'next/server'
import { COOKIE_NAME, validateSessionToken } from '@/lib/auth'

const PUBLIC_PATHS = ['/login', '/api/auth']

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl
  if (PUBLIC_PATHS.some(p => pathname.startsWith(p))) return NextResponse.next()
  const token = req.cookies.get(COOKIE_NAME)?.value
  if (!token || !(await validateSessionToken(token))) {
    return NextResponse.redirect(new URL('/login', req.url))
  }
  return NextResponse.next()
}

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] }
