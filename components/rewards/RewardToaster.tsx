'use client'

import { useEffect, useRef, useState } from 'react'
import type { CompleteState } from '@/lib/actions/schedule'
import type { BadgeGlyph } from '@/lib/gamification'
import type { RateLimited } from '@/lib/rate-limit-shared'
import { NOTICE_EVENT, type Notice } from '@/components/feedback/notify'
import { formatCountdown, useRetryCountdown } from '@/components/feedback/useRetryCountdown'
import { PixelGlyph } from './Pixel'

interface Toast {
  id: number
  glyph: BadgeGlyph | null
  title: string
  detail?: string
  tone: 'reward' | 'muted' | 'error'
  rateLimit?: RateLimited
}

/** A rate-limit toast stays while the wait is short enough to watch, up to this. */
const MAX_LIMIT_TOAST_MS = 10_000

function toastDuration(toast: Omit<Toast, 'id'>): number {
  if (toast.rateLimit) {
    return Math.min(MAX_LIMIT_TOAST_MS, Math.max(4000, toast.rateLimit.retryAt - Date.now()))
  }
  return toast.tone === 'reward' ? 4500 : 3000
}

/** The wait, ticking, so the toast is never out of date while it is on screen. */
function LimitDetail({ rateLimit }: { rateLimit: RateLimited }) {
  const seconds = useRetryCountdown(rateLimit)
  if (seconds < 0) return null
  return (
    <div className="small">
      {seconds > 0 ? (
        <>
          Too many {rateLimit.what}. Try again in <span className="tnum fw-semibold">{formatCountdown(seconds)}</span>.
        </>
      ) : (
        'You can try again now.'
      )}
    </div>
  )
}

export const REWARD_EVENT = 'flowstate:reward'

/**
 * Announces what a completion earned.
 *
 * Completion controls live in many places (the day list, the calendar grid,
 * the dashboard) and are separate client islands, so they announce through a
 * window event rather than a shared context. One toaster in the dashboard
 * layout listens.
 */
export function RewardToaster() {
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(1)

  useEffect(() => {
    function push(items: Omit<Toast, 'id'>[]) {
      const stamped = items.map((item) => ({ ...item, id: nextId.current++ }))
      setToasts((current) => [...current, ...stamped].slice(-4))
      for (const toast of stamped) {
        window.setTimeout(
          () => setToasts((current) => current.filter((t) => t.id !== toast.id)),
          toastDuration(toast),
        )
      }
    }

    function onReward(event: Event) {
      const state = (event as CustomEvent<CompleteState>).detail
      if (state.rateLimit) {
        push([{ glyph: null, title: 'Slow down a little', tone: 'error', rateLimit: state.rateLimit }])
        return
      }
      if (state.error) {
        push([{ glyph: null, title: state.error, tone: 'error' }])
        return
      }
      const r = state.rewards
      if (!r) return

      const items: Omit<Toast, 'id'>[] = []
      if (state.status === 'COMPLETED' && state.pending) {
        items.push({
          glyph: 'sprout',
          title: 'Marked done',
          detail: 'XP lands when this block starts.',
          tone: 'muted',
        })
      } else if (r.xpDelta > 0) {
        items.push({
          glyph: 'gem',
          title: `+${r.xpDelta} XP`,
          detail: r.streak > 1 ? `${r.streak}-day streak` : 'Block complete',
          tone: 'reward',
        })
      } else if (r.xpDelta < 0) {
        items.push({ glyph: null, title: `${r.xpDelta} XP`, detail: 'Block reopened', tone: 'muted' })
      }

      if (r.leveledUp) items.push({ glyph: 'star', title: `Level ${r.level}!`, detail: 'You levelled up.', tone: 'reward' })
      for (const name of r.avatars) items.push({ glyph: 'chest', title: 'Avatar unlocked', detail: name, tone: 'reward' })
      for (const name of r.seasons) items.push({ glyph: 'sun', title: 'Season unlocked', detail: name, tone: 'reward' })
      for (const name of r.badges) items.push({ glyph: 'trophy', title: 'Badge earned', detail: name, tone: 'reward' })

      if (items.length > 0) push(items)
    }

    // Refusals from controls that have no form of their own: deletes, toggles,
    // equip buttons. See components/feedback/notify.ts.
    function onNotice(event: Event) {
      const notice = (event as CustomEvent<Notice>).detail
      push([
        {
          glyph: null,
          title: notice.title,
          detail: notice.rateLimit ? undefined : notice.detail,
          tone: notice.tone,
          rateLimit: notice.rateLimit,
        },
      ])
    }

    window.addEventListener(REWARD_EVENT, onReward)
    window.addEventListener(NOTICE_EVENT, onNotice)
    return () => {
      window.removeEventListener(REWARD_EVENT, onReward)
      window.removeEventListener(NOTICE_EVENT, onNotice)
    }
  }, [])

  return (
    <div className="reward-toasts" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`reward-toast reward-toast-${toast.tone}`}>
          {toast.glyph && <PixelGlyph glyph={toast.glyph} size={28} />}
          <div className="min-width-0">
            <div className={toast.tone === 'reward' ? 'font-pixel reward-toast-title' : 'fw-semibold small'}>
              {toast.title}
            </div>
            {toast.detail && <div className="small">{toast.detail}</div>}
            {toast.rateLimit && <LimitDetail rateLimit={toast.rateLimit} />}
          </div>
        </div>
      ))}
    </div>
  )
}
