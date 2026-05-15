import { NextRequest, NextResponse } from 'next/server'

const PUBLIC_PATHS = ['/login']

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl
  if (PUBLIC_PATHS.some(p => pathname.startsWith(p))) return NextResponse.next()
  return NextResponse.redirect(new URL('/login', req.url))
}

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] }
