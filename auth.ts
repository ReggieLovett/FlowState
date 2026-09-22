import NextAuth, { CredentialsSignin } from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import { PrismaAdapter } from '@auth/prisma-adapter'
import type { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { z } from 'zod'

import { authConfig } from '@/auth.config'
import { prisma } from '@/lib/prisma'
import { POLICIES, consume, ipFromHeaders, peek, resetLimit } from '@/lib/rate-limit'
import { emailSchema, signInPasswordSchema } from '@/lib/validation/fields'

/**
 * Full Auth.js configuration. Node runtime only: it touches Prisma and bcrypt.
 *
 * Session strategy is "jwt", which is not a stylistic choice. The Credentials
 * provider cannot issue database sessions, so mixing Credentials with an adapter
 * requires JWT sessions. The adapter is still used, so users, OAuth accounts and
 * verification tokens are persisted; only the session itself lives in a cookie.
 */

// The same rules as the sign-in form. The Auth.js callback endpoint is public,
// so it cannot rely on the form having validated anything.
const credentialsSchema = z.object({
  email: emailSchema,
  password: signInPasswordSchema,
})

/**
 * Thrown instead of returning null when a sign-in is refused for volume.
 *
 * Auth.js carries `code` to both callers: the sign-in Server Action receives
 * the error itself, and a direct POST to /api/auth/callback/credentials is
 * redirected to /login?error=CredentialsSignin&code=rate_limited. The code
 * says "slow down", which reveals nothing about whether the account exists.
 */
export const RATE_LIMITED_CODE = 'rate_limited'

class SignInRateLimited extends CredentialsSignin {
  code = RATE_LIMITED_CODE
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,

  // Prisma's global omit changes the generated client type, while the Auth.js
  // adapter still declares the unconfigured PrismaClient type. The runtime
  // client remains the same; this cast is limited to the adapter boundary.
  adapter: PrismaAdapter(prisma as unknown as PrismaClient),

  session: {
    strategy: 'jwt',
    maxAge: 30 * 24 * 60 * 60,
  },

  providers: [
    ...authConfig.providers,

    Credentials({
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },

      // The limits live here, not in the sign-in Server Action, because this is
      // the one place every password check passes through. The Auth.js
      // callback endpoint is public, so a limit in the form action alone would
      // be skipped by anyone posting to it directly.
      async authorize(rawCredentials, request) {
        const parsed = credentialsSchema.safeParse(rawCredentials)
        if (!parsed.success) return null

        const { email: account, password } = parsed.data

        // Every attempt from this IP counts, before any bcrypt work is spent.
        const byIp = await consume(POLICIES.signInIp, ipFromHeaders(request.headers))
        if (!byIp.ok) throw new SignInRateLimited()

        // Only failures count against the account (below), so this is a read.
        // `remaining === 0` rather than `!ok`: a read taken before an attempt
        // must refuse once the allowance is used up, not one failure later.
        const byAccount = await peek(POLICIES.signInAccount, account)
        if (byAccount.remaining === 0) throw new SignInRateLimited()

        const user = await prisma.user.findUnique({
          where: { email: account },
          omit: { passwordHash: false },
        })

        // An OAuth-only account has no passwordHash. Comparing against a dummy
        // hash regardless keeps the response time of "no such user", "OAuth-only
        // user" and "wrong password" indistinguishable, so the endpoint cannot
        // be used to enumerate registered addresses.
        const hash = user?.passwordHash ?? DUMMY_HASH
        const passwordMatches = await bcrypt.compare(password, hash)

        if (!user?.passwordHash || !passwordMatches) {
          // Counted whether or not the address is registered, so the limit
          // behaves identically for both and cannot be used to tell them apart.
          await consume(POLICIES.signInAccount, account)
          return null
        }

        // A correct password clears earlier typos, so the owner is never left
        // one mistake away from a lockout.
        await resetLimit(POLICIES.signInAccount, account)
        return { id: user.id, email: user.email, name: user.name, image: user.image }
      },
    }),
  ],

})

/**
 * A real bcrypt hash of a value no user can supply. Only ever used to burn the
 * same CPU time as a genuine comparison. Never matches.
 */
const DUMMY_HASH = '$2b$12$C6UzMDM.H6dfI/f/IKcEe.uQOJ8pXH0Q0dQZ9lPO0Cb9E9zGVJ0Xq'
