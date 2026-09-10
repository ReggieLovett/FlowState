import NextAuth from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import { PrismaAdapter } from '@auth/prisma-adapter'
import type { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { z } from 'zod'

import { authConfig } from '@/auth.config'
import { prisma } from '@/lib/prisma'

/**
 * Full Auth.js configuration. Node runtime only: it touches Prisma and bcrypt.
 *
 * Session strategy is "jwt", which is not a stylistic choice. The Credentials
 * provider cannot issue database sessions, so mixing Credentials with an adapter
 * requires JWT sessions. The adapter is still used, so users, OAuth accounts and
 * verification tokens are persisted; only the session itself lives in a cookie.
 */

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
})

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

      async authorize(rawCredentials) {
        const parsed = credentialsSchema.safeParse(rawCredentials)
        if (!parsed.success) return null

        const { email, password } = parsed.data

        const user = await prisma.user.findUnique({
          where: { email: email.toLowerCase() },
          omit: { passwordHash: false },
        })

        // An OAuth-only account has no passwordHash. Comparing against a dummy
        // hash regardless keeps the response time of "no such user", "OAuth-only
        // user" and "wrong password" indistinguishable, so the endpoint cannot
        // be used to enumerate registered addresses.
        const hash = user?.passwordHash ?? DUMMY_HASH
        const passwordMatches = await bcrypt.compare(password, hash)

        if (!user?.passwordHash || !passwordMatches) return null

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
