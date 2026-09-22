import NextAuth from 'next-auth'
import { NextResponse } from 'next/server'
import { authConfig } from '@/auth.config'
import { contentSecurityPolicy, createNonce } from '@/lib/http/csp'

/**
 * Request pipeline: route protection, then the Content Security Policy.
 *
 * Built from auth.config.ts, which carries no adapter and no Credentials
 * provider, so this file never pulls Prisma or bcrypt into the proxy bundle.
 *
 * ---- Why the redirect lives in the `authorized` callback ----
 * Auth.js only performs its default "send them to sign-in" redirect when no
 * handler is passed to `auth()`. Passing one, as this file does to attach the
 * CSP, skips that redirect entirely and runs the handler for signed-out
 * visitors too. So `authorized` returns the redirect Response itself, which
 * Auth.js honours before the handler is ever reached. Returning a bare `false`
 * there would silently unprotect the dashboard the moment a handler was added.
 *
 * Still a convenience rather than the security boundary: the dashboard layout
 * re-checks the session and every query is scoped by `requireUserId()`.
 */
const { auth } = NextAuth(authConfig)

export default auth((request) => {
  const nonce = createNonce()
  // Behind Vercel the edge terminates TLS and forwards the original scheme.
  const https =
    request.headers.get('x-forwarded-proto') === 'https' || request.nextUrl.protocol === 'https:'
  const policy = contentSecurityPolicy(nonce, { https })

  // Next.js reads the nonce out of the *request* CSP header while rendering and
  // applies it to its own scripts; the layout reads `x-nonce` for the one
  // inline script this app writes itself.
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-nonce', nonce)
  requestHeaders.set('Content-Security-Policy', policy)

  const response = NextResponse.next({ request: { headers: requestHeaders } })
  response.headers.set('Content-Security-Policy', policy)
  return response
})

export const config = {
  // Skip static assets, image optimisation and the Auth.js endpoints themselves.
  matcher: ['/((?!api/auth|_next/static|_next/image|favicon.ico|icon.svg).*)'],
}
