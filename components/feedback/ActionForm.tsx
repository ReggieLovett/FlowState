'use client'

import { useActionState, useEffect, type ReactNode } from 'react'
import type { ActionState } from '@/lib/actions/schedule'
import { notify } from './notify'

const INITIAL: ActionState = {}

/**
 * A form for Server Actions that have no dialog to report into.
 *
 * These used to be plain `<form action={serverAction}>` posting actions that
 * returned nothing, so a refusal had nowhere to go: the click appeared to do
 * nothing. Wrapping them in useActionState keeps them working before hydration
 * and routes any error, rate limits included, to the toaster.
 */
export function ActionForm({
  action,
  children,
  className,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>
  children: ReactNode
  className?: string
}) {
  const [state, formAction] = useActionState(action, INITIAL)

  useEffect(() => {
    if (!state.error) return
    notify({
      title: state.rateLimit ? 'Slow down a little' : 'That did not go through',
      detail: state.error,
      tone: 'error',
      rateLimit: state.rateLimit,
    })
  }, [state])

  return (
    <form action={formAction} className={className}>
      {children}
    </form>
  )
}
