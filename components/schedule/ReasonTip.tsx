'use client'

import { useCallback, useEffect, useId, useRef, useState, type FocusEvent, type PointerEvent } from 'react'
import { createPortal } from 'react-dom'

/**
 * The planner's "why this time" note, shown when hovering a scheduled block.
 *
 * Rendered through a portal because blocks live inside scrolling, clipped
 * containers that would cut a tooltip off. The portal target is the nearest
 * open <dialog> when there is one: the plan review runs in a modal dialog,
 * which sits in the browser's top layer, and a tooltip portaled to <body> would
 * render behind it.
 *
 * Shown on hover after a short delay, so sweeping the pointer across a week
 * does not strobe notes, and at once on keyboard focus. Hidden the moment a
 * pointer goes down, since that is how a drag starts. Touch has no hover, so
 * the edit dialog repeats the reason for phones.
 */

const SHOW_DELAY_MS = 350
const GAP = 8

interface Tip {
  /** Which block the tip belongs to, so only that one is described by it. */
  key: string
  heading: string
  text: string
  muted: boolean
  rect: DOMRect
  container: Element
}

export interface ReasonTipContent {
  /** e.g. "Why 09:00". */
  heading: string
  text: string
  /** Rendered quieter, for notes such as "moved by you". */
  muted?: boolean
}

export function useReasonTip() {
  const [tip, setTip] = useState<Tip | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const id = useId()

  const hide = useCallback(() => {
    window.clearTimeout(timer.current)
    setTip(null)
  }, [])

  const show = useCallback((key: string, el: HTMLElement, content: ReasonTipContent, delay: number) => {
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      // The element may have unmounted during the delay, e.g. a drag began.
      if (!el.isConnected) return
      setTip({
        key,
        heading: content.heading,
        text: content.text,
        muted: Boolean(content.muted),
        rect: el.getBoundingClientRect(),
        container: el.closest('dialog[open]') ?? document.body,
      })
    }, delay)
  }, [])

  useEffect(() => {
    if (!tip) return
    // A scroll moves the block out from under a fixed tooltip, and Escape is
    // the expected way to dismiss one.
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && hide()
    window.addEventListener('scroll', hide, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('scroll', hide, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [tip, hide])

  useEffect(() => () => window.clearTimeout(timer.current), [])

  /**
   * Handlers for a block's outer element. `key` identifies the block; null
   * content means it has no tooltip.
   */
  function bind(key: string, content: ReasonTipContent | null) {
    if (!content) return {}
    return {
      'aria-describedby': tip?.key === key ? id : undefined,
      onPointerEnter: (e: PointerEvent<HTMLElement>) => {
        if (e.pointerType !== 'touch') show(key, e.currentTarget, content, SHOW_DELAY_MS)
      },
      onPointerLeave: hide,
      // Pointer down starts drags; a tooltip hanging over the block would hide
      // where it lands. Capture phase, because the resize handle stops the
      // event from bubbling so it does not also start a move.
      onPointerDownCapture: hide,
      onFocus: (e: FocusEvent<HTMLElement>) => {
        // Keyboard focus only. A mouse click also focuses, and it opens the
        // editor, which already shows the reason.
        if ((e.target as HTMLElement).matches(':focus-visible')) show(key, e.currentTarget, content, 0)
      },
      onBlur: hide,
    }
  }

  const node =
    tip &&
    createPortal(<TipBubble id={id} tip={tip} />, tip.container)

  return { bind, node }
}

function TipBubble({ id, tip }: { id: string; tip: Tip }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number; below: boolean } | null>(null)

  // Measured after first render, since the bubble's height depends on how the
  // text wraps. Above the block when there is room, below it otherwise, and
  // kept inside the viewport horizontally.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    const below = tip.rect.top - height - GAP < 8
    const top = below ? tip.rect.bottom + GAP : tip.rect.top - height - GAP
    const centre = tip.rect.left + tip.rect.width / 2
    const left = Math.min(window.innerWidth - width - 8, Math.max(8, centre - width / 2))
    setPos({ top, left, below })
  }, [tip])

  return (
    <div
      ref={ref}
      id={id}
      role="tooltip"
      className={`plan-tip${pos?.below ? ' is-below' : ''}${tip.muted ? ' is-muted' : ''}`}
      style={pos ? { top: pos.top, left: pos.left } : { top: -9999, left: -9999, visibility: 'hidden' }}
    >
      <span className="plan-tip-heading">
        <i className={`bi ${tip.muted ? 'bi-hand-index' : 'bi-stars'}`} aria-hidden="true" />
        {tip.heading}
      </span>
      <span className="plan-tip-text">{tip.text}</span>
    </div>
  )
}
