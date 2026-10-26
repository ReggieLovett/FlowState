'use client'

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { CSSProperties, FormEvent, KeyboardEvent, PointerEvent } from 'react'
import { useRouter } from 'next/navigation'
import type {
  AssistantChange,
  AssistantDecisionResponse,
  AssistantProposal,
  AssistantResponse,
} from '@/lib/assistant/contracts'
import { IsagiAvatar } from './IsagiAvatar'
import type { IsagiVision } from './IsagiAvatar'
import styles from './assistant.module.css'

type Phase = 'idle' | 'thinking' | 'speaking' | 'approval' | 'success' | 'error'
type Position = { x: number; y: number }
type Drag = { pointerId: number; clientX: number; clientY: number; origin: Position; moved: boolean }

const INITIAL_WIDGET_STYLE: CSSProperties = { visibility: 'hidden' }
const GREETING = 'A little space for your next big move. Ask me to find focus time, spot conflicts, or rethink your day.'
const STATUS: Record<Phase, string> = {
  idle: 'Ready when you are',
  thinking: 'Meta vision · reading your timeline',
  speaking: 'Omni vision · next move found',
  approval: 'Your call. Review the plan.',
  success: 'A clearer day ahead',
  error: 'Let’s try that again',
}

function ArrowIcon() {
  return <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true"><path d="M12 18V6m-5 5 5-5 5 5" strokeLinecap="round" strokeLinejoin="round" /></svg>
}

function MoveIcon() {
  return <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M12 3v18M3 12h18M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3m12-6 3 3-3 3" strokeLinecap="round" strokeLinejoin="round" /></svg>
}

function CloseIcon() {
  return <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="m7 7 10 10M7 17 17 7" strokeLinecap="round" /></svg>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isChange(value: unknown): value is AssistantChange {
  return isRecord(value) && ['eventId', 'title', 'fromStart', 'fromEnd', 'toStart', 'toEnd', 'reason'].every(key => typeof value[key] === 'string')
    && ['fromStart', 'fromEnd', 'toStart', 'toEnd'].every(key => Number.isFinite(Date.parse(value[key] as string)))
}

function isAssistantResponse(value: unknown): value is AssistantResponse {
  if (!isRecord(value) || typeof value.message !== 'string' || !isRecord(value.calendar) || typeof value.calendar.connected !== 'boolean') return false
  if (value.proposal === undefined) return true
  return isRecord(value.proposal) && typeof value.proposal.id === 'string' && typeof value.proposal.expiresAt === 'string'
    && Number.isFinite(Date.parse(value.proposal.expiresAt)) && Array.isArray(value.proposal.changes)
    && value.proposal.changes.length > 0 && value.proposal.changes.every(isChange)
}

async function postJson(url: string, body: unknown, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(body),
    signal,
  })
  const data: unknown = await response.json().catch(() => null)
  if (!response.ok) throw new Error(isRecord(data) && typeof data.error === 'string' ? data.error : 'The assistant could not complete that request. Please try again.')
  return data
}

function formatDateTime(value: string, timeZone: string) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZone, timeZoneName: 'short',
  }).format(new Date(value))
}

function ChangePreview({ change, timeZone }: { change: AssistantChange; timeZone: string }) {
  return (
    <li className={styles.change}>
      <strong>{change.title}</strong>
      <dl className={styles.times}>
        <div><dt>Current</dt><dd><time dateTime={change.fromStart}>{formatDateTime(change.fromStart, timeZone)}</time><span aria-hidden="true"> → </span><span className={styles.srOnly}> to </span><time dateTime={change.fromEnd}>{formatDateTime(change.fromEnd, timeZone)}</time></dd></div>
        <div><dt>Proposed</dt><dd><time dateTime={change.toStart}>{formatDateTime(change.toStart, timeZone)}</time><span aria-hidden="true"> → </span><span className={styles.srOnly}> to </span><time dateTime={change.toEnd}>{formatDateTime(change.toEnd, timeZone)}</time></dd></div>
      </dl>
      <p className={styles.reason}>{change.reason}</p>
    </li>
  )
}

export default function FloatingAssistant() {
  const router = useRouter()
  const id = useId()
  const [open, setOpen] = useState(true)
  const [prompt, setPrompt] = useState('')
  const [message, setMessage] = useState(GREETING)
  const [phase, setPhase] = useState<Phase>('idle')
  const [deepThinking, setDeepThinking] = useState(false)
  const [walking, setWalking] = useState(false)
  const [proposal, setProposal] = useState<AssistantProposal | null>(null)
  const [expired, setExpired] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [calendar, setCalendar] = useState<AssistantResponse['calendar'] | null>(null)
  const [deciding, setDeciding] = useState<'confirm' | 'cancel' | null>(null)
  const [timeZone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC')
  const hostRef = useRef<HTMLDivElement>(null)
  const boundsRef = useRef<HTMLDivElement>(null)
  const widgetRef = useRef<HTMLDivElement>(null)
  const avatarRef = useRef<HTMLButtonElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const positionRef = useRef<Position | null>(null)
  const sizeRef = useRef({ width: 0, height: 0 })
  const dragRef = useRef<Drag | null>(null)
  const suppressClickRef = useRef(false)
  const requestRef = useRef<AbortController | null>(null)
  const speakingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const visionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const walkTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const walkingRef = useRef(false)
  const travelRef = useRef<Animation | null>(null)
  const cornerRef = useRef(0)
  const busy = phase === 'thinking' || deciding !== null
  const vision: IsagiVision = phase === 'thinking' ? deepThinking ? 'omni' : 'meta' : phase === 'speaking' ? 'omni' : 'normal'

  const walkFor = useCallback((duration: number) => {
    if (!walkingRef.current) {
      walkingRef.current = true
      setWalking(true)
    }
    if (walkTimerRef.current) clearTimeout(walkTimerRef.current)
    walkTimerRef.current = setTimeout(() => {
      walkingRef.current = false
      setWalking(false)
    }, duration)
  }, [])

  function stopTravel() {
    const widget = widgetRef.current
    if (!widget || !travelRef.current) return
    const matrix = new DOMMatrixReadOnly(getComputedStyle(widget).transform)
    travelRef.current.cancel()
    travelRef.current = null
    positionRef.current = { x: matrix.m41, y: matrix.m42 }
    widget.style.transform = `translate3d(${matrix.m41}px, ${matrix.m42}px, 0)`
    if (walkTimerRef.current) clearTimeout(walkTimerRef.current)
    walkingRef.current = false
    setWalking(false)
  }

  const positionAt = useCallback((point: Position, travel = false) => {
    const bounds = boundsRef.current
    const widget = widgetRef.current
    if (!bounds || !widget) return
    const next = {
      x: Math.max(0, Math.min(point.x, bounds.clientWidth - widget.offsetWidth)),
      y: Math.max(0, Math.min(point.y, bounds.clientHeight - widget.offsetHeight)),
    }
    const previous = positionRef.current
    const from = travel ? getComputedStyle(widget).transform : ''
    travelRef.current?.cancel()
    travelRef.current = null
    positionRef.current = next
    // Pointer motion is transient; avoid a React render for each pointer sample.
    widget.style.transform = `translate3d(${next.x}px, ${next.y}px, 0)`
    // Deliberate corner moves walk across the screen; direct dragging stays under the pointer.
    if (travel && previous && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const distance = Math.hypot(next.x - previous.x, next.y - previous.y)
      if (distance < 4) return
      const duration = Math.max(360, Math.min(1400, distance * 1.4))
      travelRef.current = widget.animate([
        { transform: from },
        { transform: `translate3d(${next.x}px, ${next.y}px, 0)` },
      ], { duration, easing: 'linear' })
      walkFor(duration)
    }
  }, [walkFor])

  useEffect(() => {
    const host = hostRef.current
    const bounds = boundsRef.current
    const widget = widgetRef.current
    if (!host || !bounds || !widget) return

    function measure() {
      if (!host || !bounds || !widget) return
      const viewport = window.visualViewport
      host.style.height = `${viewport?.height ?? window.innerHeight}px`
      host.style.width = `${viewport?.width ?? window.innerWidth}px`
      host.style.top = `${viewport?.offsetTop ?? 0}px`
      host.style.left = `${viewport?.offsetLeft ?? 0}px`
      host.style.setProperty('--assistant-viewport-height', `${viewport?.height ?? window.innerHeight}px`)
      const width = widget.offsetWidth
      const height = widget.offsetHeight
      const previous = positionRef.current
      // Preserve the avatar's bottom-right anchor when its dialogue grows.
      positionAt(previous
        ? { x: previous.x + sizeRef.current.width - width, y: previous.y + sizeRef.current.height - height }
        : { x: bounds.clientWidth - width, y: bounds.clientHeight - height })
      sizeRef.current = { width, height }
      widget.style.visibility = 'visible'
    }

    const observer = new ResizeObserver(measure)
    observer.observe(bounds)
    observer.observe(widget)
    window.addEventListener('resize', measure)
    window.visualViewport?.addEventListener('resize', measure)
    window.visualViewport?.addEventListener('scroll', measure)
    measure()
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
      window.visualViewport?.removeEventListener('resize', measure)
      window.visualViewport?.removeEventListener('scroll', measure)
      requestRef.current?.abort()
      if (speakingTimerRef.current) clearTimeout(speakingTimerRef.current)
      if (visionTimerRef.current) clearTimeout(visionTimerRef.current)
      if (walkTimerRef.current) clearTimeout(walkTimerRef.current)
      travelRef.current?.cancel()
    }
  }, [positionAt])

  useEffect(() => {
    if (!proposal) return
    const timer = setTimeout(() => setExpired(true), Math.max(0, Date.parse(proposal.expiresAt) - Date.now()))
    return () => clearTimeout(timer)
  }, [proposal])

  function minimize() {
    stopTravel()
    setOpen(false)
    avatarRef.current?.focus({ preventScroll: true })
  }

  function toggleOpen(keyboard = false) {
    if (suppressClickRef.current && !keyboard) {
      suppressClickRef.current = false
      return
    }
    suppressClickRef.current = false
    stopTravel()
    if (widgetRef.current) widgetRef.current.dataset.keyboard = String(keyboard)
    setOpen(current => !current)
    // Keyboard users move straight to the input when they summon the companion.
    if (!open && keyboard) requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }))
  }

  function moveToCorner() {
    const bounds = boundsRef.current
    const widget = widgetRef.current
    if (!bounds || !widget) return
    const next = ++cornerRef.current % 4
    positionAt({
      x: next === 0 || next === 3 ? bounds.clientWidth - widget.offsetWidth : 0,
      y: next < 2 ? bounds.clientHeight - widget.offsetHeight : 0,
    }, true)
  }

  function startDrag(event: PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0 || !positionRef.current) return
    stopTravel()
    suppressClickRef.current = false
    dragRef.current = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, origin: { ...positionRef.current }, moved: false }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function moveDrag(event: PointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const dx = event.clientX - drag.clientX
    const dy = event.clientY - drag.clientY
    if (!drag.moved && Math.hypot(dx, dy) < 5) return
    drag.moved = true
    if (widgetRef.current) widgetRef.current.dataset.dragging = 'true'
    positionAt({ x: drag.origin.x + dx, y: drag.origin.y + dy })
    walkFor(240)
  }

  function finishDrag(event: PointerEvent<HTMLButtonElement>) {
    if (!dragRef.current || dragRef.current.pointerId !== event.pointerId) return
    suppressClickRef.current = dragRef.current.moved || event.type === 'pointercancel'
    dragRef.current = null
    if (widgetRef.current) delete widgetRef.current.dataset.dragging
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  function moveWithKeyboard(event: KeyboardEvent<HTMLButtonElement>) {
    const point = positionRef.current
    if (!point) return
    const step = event.shiftKey ? 8 : 32
    const movement: Record<string, Position> = {
      ArrowLeft: { x: -step, y: 0 }, ArrowRight: { x: step, y: 0 },
      ArrowUp: { x: 0, y: -step }, ArrowDown: { x: 0, y: step },
    }
    if (movement[event.key]) {
      event.preventDefault()
      stopTravel()
      const current = positionRef.current ?? point
      positionAt({ x: current.x + movement[event.key].x, y: current.y + movement[event.key].y })
      walkFor(480)
    } else if (event.key === 'Home') {
      event.preventDefault()
      cornerRef.current = 3
      moveToCorner()
    }
  }

  async function ask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const text = prompt.trim()
    if (!text || busy || proposal || requestRef.current) return
    const controller = new AbortController()
    requestRef.current = controller
    if (speakingTimerRef.current) clearTimeout(speakingTimerRef.current)
    setError(null)
    setDeepThinking(false)
    setPhase('thinking')
    visionTimerRef.current = setTimeout(() => setDeepThinking(true), 3500)
    try {
      const result = await postJson('/api/assistant', { prompt: text, timeZone }, controller.signal)
      if (!isAssistantResponse(result)) throw new Error('The assistant returned an incomplete response. Please try again.')
      setMessage(result.message)
      setCalendar(result.calendar)
      setProposal(result.proposal ?? null)
      setExpired(result.proposal ? Date.now() >= Date.parse(result.proposal.expiresAt) : false)
      setPrompt('')
      setPhase('speaking')
      speakingTimerRef.current = setTimeout(() => setPhase(result.proposal ? 'approval' : 'idle'), 2200)
    } catch (failure) {
      if (controller.signal.aborted) return
      setError(failure instanceof Error ? failure.message : 'The connection was interrupted. Your prompt is saved below.')
      setPhase('error')
    } finally {
      if (visionTimerRef.current) clearTimeout(visionTimerRef.current)
      if (requestRef.current === controller) requestRef.current = null
    }
  }

  async function decide(action: 'confirm' | 'cancel') {
    if (!proposal || busy || requestRef.current || (action === 'confirm' && expired)) return
    const controller = new AbortController()
    requestRef.current = controller
    if (speakingTimerRef.current) clearTimeout(speakingTimerRef.current)
    setDeciding(action)
    setError(null)
    try {
      // Approval sends only the saved proposal id and action, never new instructions or edited times.
      const result = await postJson(`/api/assistant/proposals/${encodeURIComponent(proposal.id)}`, { action }, controller.signal)
      if (!isRecord(result) || typeof result.message !== 'string' || (result.status !== 'APPLIED' && result.status !== 'CANCELLED')) throw new Error('The confirmation response was incomplete. Retry to check the saved plan’s status.')
      const decision = result as unknown as AssistantDecisionResponse
      setMessage(decision.message)
      setProposal(null)
      setPhase(decision.status === 'APPLIED' ? 'success' : 'idle')
      if (decision.status === 'APPLIED') router.refresh()
      requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }))
    } catch (failure) {
      if (controller.signal.aborted) return
      setError(failure instanceof Error ? failure.message : 'The connection was interrupted. Retry to check this plan’s status.')
      setPhase('approval')
    } finally {
      if (requestRef.current === controller) requestRef.current = null
      if (!controller.signal.aborted) setDeciding(null)
    }
  }

  return (
    <div ref={hostRef} className={styles.host}>
      <div ref={boundsRef} className={styles.bounds}>
        <section
          ref={widgetRef}
          className={`${styles.widget} ${open ? styles.open : styles.closed}`}
          style={INITIAL_WIDGET_STYLE}
          aria-label="Isagi scheduling assistant"
          data-phase={phase}
          onFocusCapture={event => { if (event.target === inputRef.current || event.target === event.currentTarget.querySelector(`.${styles.bubbleContent}`)) stopTravel() }}
          onKeyDown={event => { if (event.key === 'Escape' && open) { event.preventDefault(); minimize() } }}
        >
          <p className={styles.srOnly} id={`${id}-movement`}>Drag Isagi to move. With Isagi focused, use the arrow keys to move, Shift for smaller steps, or Home to reset. The Move to next corner button also repositions him.</p>
          <span className={styles.srOnly} role="status" aria-live="polite">{busy ? deciding ? `${deciding === 'confirm' ? 'Confirming' : 'Cancelling'} your plan.` : 'Isagi is reading your schedule and Google Calendar.' : STATUS[phase]}</span>

          {open ? (
            <>
              <div className={styles.bubble} id={`${id}-dialogue`}>
                <div className={styles.bubbleHeader}>
                  <div><span className={styles.eyebrow}>YOUR TIMELINE, REIMAGINED</span><strong>Isagi <span className={styles.liveDot} aria-hidden="true" /></strong></div>
                  <div className={styles.tools}>
                    <button type="button" className={styles.iconButton} onClick={moveToCorner} aria-label="Move Isagi to the next corner" title="Move to next corner"><MoveIcon /></button>
                    <button type="button" className={styles.iconButton} onClick={minimize} aria-label="Minimize assistant" title="Minimize (Escape)"><CloseIcon /></button>
                  </div>
                </div>
                <div className={styles.bubbleContent} tabIndex={0} aria-label="Assistant dialogue and proposed changes">
                  {phase === 'thinking' ? <p className={styles.thinking}><span className={styles.thinkingDots} aria-hidden="true"><i /><i /><i /></span>Reading the field. Finding your flow.</p> : <p className={styles.message} role="status" aria-live="polite">{message}</p>}
                  {error ? <p className={styles.error} role="alert">{error}</p> : null}
                  {proposal ? (
                    <div className={styles.proposal}>
                      <div className={styles.proposalHeading}><span className={styles.planIcon} aria-hidden="true">↗</span><div><strong>{proposal.changes.length} {proposal.changes.length === 1 ? 'move' : 'moves'} for a better day</strong><span>Review every change before confirming.</span></div></div>
                      <ol className={styles.changes}>{proposal.changes.map(change => <ChangePreview key={change.eventId} change={change} timeZone={timeZone} />)}</ol>
                    </div>
                  ) : null}
                  {calendar?.warning ? <p className={styles.calendarNote}>{calendar.warning}</p> : calendar ? <p className={styles.calendarNote}>{calendar.connected ? 'Includes your connected Google Calendar.' : 'Using FlowState events. Connect Google Calendar in Settings to include it.'}</p> : null}
                </div>
                {proposal ? (
                  <div className={styles.confirmation}>
                    <p>{expired ? 'This plan expired. Cancel it to request a fresh plan.' : 'Only Confirm applies these schedule changes.'}</p>
                    <div className={styles.decisionButtons}>
                      <button type="button" className={styles.cancelButton} onClick={() => void decide('cancel')} disabled={busy}>{deciding === 'cancel' ? 'Cancelling…' : 'Cancel'}</button>
                      <button type="button" className={styles.confirmButton} onClick={() => void decide('confirm')} disabled={busy || expired}>{deciding === 'confirm' ? 'Confirming…' : 'Confirm changes'}<span aria-hidden="true">↗</span></button>
                    </div>
                  </div>
                ) : null}
              </div>
              <form className={styles.composer} onSubmit={ask} aria-label="Ask Isagi">
                <div className={styles.inputGroup}>
                  <label htmlFor={`${id}-prompt`}>{proposal ? 'Review your plan above' : 'Ask Isagi'}</label>
                  <input ref={inputRef} id={`${id}-prompt`} type="text" value={prompt} onChange={event => setPrompt(event.target.value)} placeholder="Find my next move…" maxLength={2000} disabled={busy || proposal !== null} autoComplete="off" aria-describedby={`${id}-privacy`} />
                </div>
                <button type="submit" className={styles.sendButton} disabled={!prompt.trim() || busy || proposal !== null} aria-label="Send prompt"><ArrowIcon /></button>
              </form>
              <span className={styles.srOnly} id={`${id}-privacy`}>Your prompt and relevant schedule details are sent to Groq. Schedule changes always require your confirmation.</span>
            </>
          ) : null}

          <div className={styles.avatarSlot}>
            <button
              ref={avatarRef}
              type="button"
              className={styles.avatarButton}
              aria-label={`${open ? 'Minimize' : 'Open'} Isagi assistant${proposal ? ', plan waiting for approval' : ''}`}
              aria-expanded={open}
              aria-controls={open ? `${id}-dialogue` : undefined}
              aria-describedby={`${id}-movement`}
              title="Drag to move · Arrow keys to position · Home to reset"
              onPointerDown={startDrag}
              onPointerMove={moveDrag}
              onPointerUp={finishDrag}
              onPointerCancel={finishDrag}
              onLostPointerCapture={() => { dragRef.current = null; if (widgetRef.current) delete widgetRef.current.dataset.dragging }}
              onKeyDown={moveWithKeyboard}
              onClick={event => toggleOpen(event.detail === 0)}
            >
              <IsagiAvatar vision={vision} motion={walking ? 'walking' : 'idle'} />
              <span className={styles.avatarName}>ISAGI<span className={styles.avatarDot} aria-hidden="true" /></span>
              <span className={styles.avatarStatus}>{proposal ? 'Review plan' : vision === 'meta' ? 'Meta vision' : vision === 'omni' ? 'Omni vision' : walking ? 'On the move' : 'Your next move'}</span>
            </button>
          </div>
        </section>
      </div>
    </div>
  )
}

export { FloatingAssistant }
