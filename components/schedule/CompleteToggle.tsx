'use client'

import { useActionState, useEffect, useRef } from 'react'
import { toggleCompleteAction, type CompleteState } from '@/lib/actions/schedule'
import { REWARD_EVENT } from '@/components/rewards/RewardToaster'

const INITIAL: CompleteState = {}

/**
 * The tick control, with rewards.
 *
 * Still a form posting a Server Action, so it works before hydration. Once
 * hydrated it shows the new state immediately while the write is in flight and
 * hands the reward diff to the toaster.
 */
export function CompleteToggle({
  id,
  title,
  done,
  compact = false,
}: {
  id: string
  title: string
  done: boolean
  compact?: boolean
}) {
  const [state, formAction, pending] = useActionState(toggleCompleteAction, INITIAL)
  const announced = useRef<number | undefined>(undefined)

  useEffect(() => {
    if (state.nonce === undefined && !state.error) return
    if (state.nonce !== undefined && state.nonce === announced.current) return
    announced.current = state.nonce
    window.dispatchEvent(new CustomEvent(REWARD_EVENT, { detail: state }))
  }, [state])

  const shown = pending ? !done : done

  return (
    <form action={formAction} className="d-inline-flex">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value={done ? 'SCHEDULED' : 'COMPLETED'} />
      <button
        type="submit"
        className={
          compact
            ? `tg-check${shown ? ' is-done' : ''}`
            : `btn btn-sm ${shown ? 'btn-success' : 'btn-outline-secondary'}`
        }
        aria-label={shown ? `Reopen ${title}` : `Mark ${title} done`}
        aria-pressed={shown}
        title={shown ? 'Mark as not done' : 'Mark as done'}
        disabled={pending}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <i className="bi bi-check-lg" aria-hidden="true" />
      </button>
    </form>
  )
}
