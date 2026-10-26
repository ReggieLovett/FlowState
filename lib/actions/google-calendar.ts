'use server'

import { AuthError } from 'next-auth'
import { signIn } from '@/auth'
import { requireUserId } from '@/lib/auth-guard'

export interface CalendarConnectState {
  error?: string
}

export async function connectGoogleCalendar(_previous: CalendarConnectState): Promise<CalendarConnectState> {
  void _previous
  // The signed-in session is also what makes Auth.js safely link Google to the
  // existing account. Never link identities merely because emails match.
  await requireUserId()
  if (!process.env.AUTH_GOOGLE_ID || !process.env.AUTH_GOOGLE_SECRET) {
    return { error: 'Google Calendar is not configured yet. Add the Google OAuth credentials on the server.' }
  }
  try {
    await signIn('google', { redirectTo: '/dashboard/settings' })
  } catch (error) {
    if (error instanceof AuthError) {
      return { error: 'Google Calendar could not be connected. Try again while signed in to your FlowState account.' }
    }
    // A successful OAuth start throws Next.js's redirect; preserve it.
    throw error
  }
  return {}
}
