import type { NextAuthConfig } from 'next-auth'
import GitHub from 'next-auth/providers/github'

/**
 * The half of the Auth.js configuration that proxy.ts uses.
 *
 * It deliberately contains no adapter and no Credentials provider: only what is
 * needed to read a JWT and decide whether a request may continue, so the proxy
 * bundle never pulls in Prisma or bcrypt. The full configuration in auth.ts
 * extends this. (Next.js 16 runs the proxy on Node.js by default, so this is now
 * about keeping the proxy small rather than about Edge compatibility.)
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
    /** Runs in proxy.ts for every matched request. */
    authorized({ auth: session, request }) {
      const isSignedIn = Boolean(session?.user?.id)
      const { pathname } = request.nextUrl
      const isOnProtectedArea = pathname.startsWith('/dashboard')

      // An explicit Response, never a bare `false`. proxy.ts passes a handler to
      // `auth()`, and with a handler present Auth.js skips its own redirect for
      // `false` and runs the handler for signed-out visitors anyway. A returned
      // Response is honoured before the handler runs. See proxy.ts.
      if (isOnProtectedArea && !isSignedIn) {
        return Response.redirect(new URL('/login', request.nextUrl))
      }

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
