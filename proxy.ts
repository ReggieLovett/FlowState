import NextAuth from 'next-auth'
import { authConfig } from '@/auth.config'

/**
 * Route protection.
 *
 * Next.js 16 renamed the `middleware.ts` convention to `proxy.ts`. It also
 * requires a real function export: the `export const { auth } = NextAuth(...)`
 * destructuring that worked in 15 is not statically recognised as a function, so
 * the handler is pulled out and exported on its own line below.
 *
 * Built from auth.config.ts, which carries no adapter and no Credentials
 * provider, because this runs on the Edge runtime where Prisma and bcrypt cannot.
 * It only reads the session cookie and applies the `authorized` callback.
 *
 * This is a convenience, not the security boundary. It redirects unauthenticated
 * visitors away from the dashboard, but every query is independently scoped by
 * `requireUserId()`, so a request that somehow bypassed this still could not
 * read another user's rows.
 */
const { auth } = NextAuth(authConfig)

export default auth

export const config = {
  // Skip static assets, image optimisation and the Auth.js endpoints themselves.
  matcher: ['/((?!api/auth|_next/static|_next/image|favicon.ico|icon.svg).*)'],
}
