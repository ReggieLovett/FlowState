import type { DefaultSession } from 'next-auth'

/**
 * Adds the database user id to the session and token types.
 *
 * Auth.js ships `name`, `email` and `image` on `session.user` but not `id`. The
 * whole data-isolation model depends on that id, so it is declared once here
 * rather than cast at each call site.
 */
declare module 'next-auth' {
  interface Session {
    user: {
      id: string
    } & DefaultSession['user']
  }
}

/**
 * The JWT augmentation has to target `@auth/core/jwt`, not `next-auth/jwt`.
 * `next-auth/jwt` is a bare `export * from "@auth/core/jwt"` and declares no
 * `JWT` interface of its own, so augmenting it silently creates a new, unrelated
 * interface: the callback parameter keeps its original type and `token.id` stays
 * `unknown`.
 */
declare module '@auth/core/jwt' {
  interface JWT {
    id?: string
  }
}
