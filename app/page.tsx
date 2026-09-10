import { redirect } from 'next/navigation'
import { auth } from '@/auth'

/**
 * Entry point.
 *
 * There is no marketing page, so the root simply routes: signed-in visitors go
 * to their dashboard, everyone else to sign-in.
 */
export default async function RootPage() {
  const session = await auth()
  redirect(session?.user?.id ? '/dashboard' : '/login')
}
