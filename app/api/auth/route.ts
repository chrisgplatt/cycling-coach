import { NextRequest, NextResponse } from 'next/server'
import { createSessionToken, COOKIE_NAME, COOKIE_MAX_AGE } from '@/lib/auth'

export async function POST(req: NextRequest) {
  const { password } = await req.json()
  const token = await createSessionToken(password)

  if (!token) {
    return NextResponse.json({ error: 'Invalid password' }, { status: 401 })
  }

  const res = NextResponse.json({ ok: true })
  res.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: COOKIE_MAX_AGE,
    path: '/',
  })
  return res
}
