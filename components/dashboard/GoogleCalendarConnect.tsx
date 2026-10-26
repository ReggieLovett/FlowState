'use client'

import { useActionState } from 'react'
import { connectGoogleCalendar } from '@/lib/actions/google-calendar'

export function GoogleCalendarConnect({ connected }: { connected: boolean }) {
  const [state, action, pending] = useActionState(connectGoogleCalendar, {})

  return (
    <form action={action}>
      <button type="submit" className="btn btn-outline-secondary btn-sm" disabled={pending} style={{ minHeight: 44 }}>
        {pending ? <span className="spinner-border spinner-border-sm me-2" aria-hidden="true" /> : <i className="bi bi-google me-2" aria-hidden="true" />}
        {pending ? 'Opening Google…' : connected ? 'Reconnect Google Calendar' : 'Connect Google Calendar'}
      </button>
      {state.error ? <p className="text-danger small mt-2 mb-0" role="alert">{state.error}</p> : null}
    </form>
  )
}
