'use client'

import type { RateLimited } from '@/lib/rate-limit-shared'

/**
 * Transient notices for actions that have no form of their own to show an
 * error in: a tick, a delete button, an archive toggle.
 *
 * Dispatched as a window event, the same way completion rewards are, so any
 * client island can raise one and the single toaster in the dashboard layout
 * shows it.
 */

export const NOTICE_EVENT = 'flowstate:notice'

export interface Notice {
  title: string
  detail?: string
  tone: 'error' | 'muted'
  rateLimit?: RateLimited
}

export function notify(notice: Notice) {
  window.dispatchEvent(new CustomEvent<Notice>(NOTICE_EVENT, { detail: notice }))
}
