import type { NextAuthConfig } from 'next-auth'
import GitHub from 'next-auth/providers/github'

/**
 * Edge-safe half of the Auth.js configuration.
 *
 * This file is imported by middleware.ts, which runs on the Edge runtime where
 * Prisma and bcrypt cannot run. So it deliberately contains no adapter and no
 * Credentials provider: only the pieces needed to read a JWT and decide whether
 * a request may continue. The full configuration in auth.ts extends this.
 *
 * Splitting the config this way is the supported pattern for using a database
 * adapter alongside middleware.
 */
export const authConfig = {
  pages: {
    signIn: '/login',
    error: '/login',
  },

  providers: [
    GitHub({
      clientId: process.env.AUTH_GITHUB_ID,
      clientSecret: process.env.AUTH_GITHUB_SECRET,
      allowDangerousEmailAccountLinking: false,
    }),
  ],

  callbacks: {
    /**
     * Runs in middleware for every matched request. Returning false sends the
     * visitor to the `signIn` page above.
     */
    authorized({ auth: session, request }) {
      const isSignedIn = Boolean(session?.user?.id)
      const { pathname } = request.nextUrl
      const isOnProtectedArea = pathname.startsWith('/dashboard')

      if (isOnProtectedArea) return isSignedIn

      // Signed-in users have no reason to see the sign-in or sign-up screens.
      if (isSignedIn && (pathname === '/login' || pathname === '/register')) {
        return Response.redirect(new URL('/dashboard', request.nextUrl))
      }

      return true
    },

    /**
     * The user id is minted into the token at sign-in and read back out into the
     * session. Every isolated query downstream depends on `session.user.id`
     * being present, so it is set in one place.
     */
    jwt({ token, user }) {
      if (user) token.id = user.id
      return token
    },

    session({ session, token }) {
      if (token.id) session.user.id = token.id
      return session
    },
  },
} satisfies NextAuthConfig
