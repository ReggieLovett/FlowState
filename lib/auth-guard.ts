import 'server-only'

import { cache } from 'react'
import { redirect } from 'next/navigation'
import { auth } from '@/auth'

/**
 * The single place a request is turned into a trusted user id.
 *
 * Everything in lib/data goes through this. Nothing else in the application
 * reads `session.user.id` and nothing else passes a `userId` into a query, so
 * there is exactly one line to audit for the isolation requirement.
 *
 * Wrapped in React's `cache` so that a page calling four data functions still
 * resolves the session once per request.
 */
export const requireUserId = cache(async (): Promise<string> => {
  const session = await auth()

  if (!session?.user?.id) {
    // A Server Component cannot return a 401, so send the visitor to sign in.
    redirect('/login')
  }

  return session.user.id
})

/**
 * Route Handler variant.
 *
 * `redirect()` inside a fetch handler produces a confusing 307 to an HTML page
 * for an API client, so this returns null and lets the caller answer with a
 * proper 401.
 */
export const getUserId = cache(async (): Promise<string | null> => {
  const session = await auth()
  return session?.user?.id ?? null
})
