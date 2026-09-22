'use client'

import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'

/** The fields a drag reads, shared by React's and the DOM's pointer events. */
type PointerPoint = { clientX: number; clientY: number; pointerId: number }
import { ITEM_LABELS, type ItemKind, type PlannedBlock } from '@/lib/scheduling'
import { useReasonTip } from './ReasonTip'

/**
 * The generated plan as an editable timeline, before anything is saved.
 *
 * One row per day, time running left to right. Blocks drag along a row to
 * change time and across rows to change day, resize from their right edge,
 * and move with the arrow keys when focused. Existing commitments sit
 * underneath as hatched bars so a drop onto a lecture is visible as a clash.
 *
 * Blocks use `touch-action: none`, so a finger on a block drags it while a
 * finger on empty track still scrolls. That is more predictable on phones than
 * a long-press, which browsers race against their own scroll gesture.
 */

export interface DraftBlock extends PlannedBlock {
  key: string
  /**
   * Dragged or resized on the timeline. Its `reason` described where the
   * planner put it, so it is no longer shown or saved once the block moves.
   */
  moved?: boolean
}

export interface TimelineBusy {
  key: string
  date: string
  start: number
  end: number
  title: string
}

export interface TimelineDeadline {
  itemId: string
  date: string
  title: string
  type: ItemKind
  color: string
}

export interface BlockIssues {
  clash: boolean
  overlap: boolean
  late: boolean
  past: boolean
  outside: boolean
}

const SNAP = 15
const DAY_LABEL = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })

function parseISO(iso: string) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function minutesOfDay(date: Date) {
  return date.getHours() * 60 + date.getMinutes()
}

export function hhmm(minutes: number) {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** Returns a copy of `block` moved to `date` between `start` and `end` minutes. */
export function placeBlock(block: DraftBlock, date: string, start: number, end: number): DraftBlock {
  const base = parseISO(date)
  const startsAt = new Date(base)
  startsAt.setMinutes(start)
  const endsAt = new Date(base)
  endsAt.setMinutes(end)
  return {
    ...block,
    moved: true,
    date,
    startTime: hhmm(start),
    endTime: hhmm(end),
    duration: end - start,
    startsAt,
    endsAt,
  }
}

/**
 * What is wrong with each block where it currently sits.
 *
 * `clash` and `past` are real problems; `late` (after the item's deadline) and
 * `outside` (beyond the study hours) are allowed, because the user may know
 * better, but they are shown.
 */
export function findIssues(
  blocks: DraftBlock[],
  busy: TimelineBusy[],
  dueByItem: Record<string, { date: string; type: ItemKind }>,
  hours: { start: number; end: number },
  now: Date,
): Map<string, BlockIssues> {
  const out = new Map<string, BlockIssues>()
  for (const block of blocks) {
    const start = minutesOfDay(block.startsAt)
    const end = start + block.duration
    const due = block.itemId ? dueByItem[block.itemId] : undefined
    out.set(block.key, {
      clash: busy.some((b) => b.date === block.date && start < b.end && b.start < end),
      overlap: blocks.some(
        (other) => other.key !== block.key && other.date === block.date && other.startsAt < block.endsAt && block.startsAt < other.endsAt,
      ),
      // Tasks can be done on the day; everything else should be finished before it.
      late: Boolean(due && (due.type === 'TASK' ? block.date > due.date : block.date >= due.date)),
      past: block.startsAt < now,
      outside: start < hours.start || end > hours.end,
    })
  }
  return out
}

interface Drag {
  key: string
  mode: 'move' | 'resize'
  pointerId: number
  x: number
  y: number
  dayIndex: number
  start: number
  end: number
  pxPerMin: number
  rowHeight: number
  moved: boolean
  preview: { dayIndex: number; start: number; end: number }
}

export function PlanTimeline({
  days,
  blocks,
  busy,
  deadlines,
  issues,
  studyDays,
  studyWindow,
  now,
  selectedKey,
  onSelect,
  onMove,
  onRemove,
}: {
  days: string[]
  blocks: DraftBlock[]
  busy: TimelineBusy[]
  deadlines: TimelineDeadline[]
  issues: Map<string, BlockIssues>
  studyDays: number[]
  /** Study hours, in minutes since midnight. Not `window`, which would shadow the global. */
  studyWindow: { start: number; end: number }
  now: Date
  selectedKey: string | null
  onSelect: (key: string | null) => void
  onMove: (key: string, date: string, start: number, end: number) => void
  onRemove: (key: string) => void
}) {
  const trackRef = useRef<HTMLDivElement | null>(null)
  const rowRef = useRef<HTMLDivElement | null>(null)
  const drag = useRef<Drag | null>(null)
  const suppressClick = useRef(false)
  const [preview, setPreview] = useState<{ key: string; dayIndex: number; start: number; end: number } | null>(null)
  const reasonTip = useReasonTip()

  // Visible hours: the study window, stretched to include anything outside it,
  // rounded out to whole hours.
  const timed = [
    ...blocks.map((b) => ({ start: minutesOfDay(b.startsAt), end: minutesOfDay(b.startsAt) + b.duration })),
    ...busy.filter((b) => b.end - b.start < 20 * 60),
  ]
  const viewStart = Math.max(0, Math.floor(Math.min(studyWindow.start, ...timed.map((t) => t.start)) / 60) * 60)
  const viewEnd = Math.min(24 * 60, Math.ceil(Math.max(studyWindow.end, ...timed.map((t) => t.end), viewStart + 360) / 60) * 60)
  const span = viewEnd - viewStart
  const hours = Array.from({ length: span / 60 + 1 }, (_, i) => viewStart + i * 60)
  const pct = (minutes: number) => `${((minutes - viewStart) / span) * 100}%`

  const todayISO = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const nowMinutes = minutesOfDay(now)

  function begin(e: PointerEvent<HTMLElement>, block: DraftBlock, dayIndex: number, mode: 'move' | 'resize') {
    if (e.button !== 0) return
    const track = trackRef.current
    const row = rowRef.current
    if (!track || !row) return
    if (mode === 'resize') e.stopPropagation()
    e.preventDefault()
    const start = minutesOfDay(block.startsAt)
    drag.current = {
      key: block.key,
      mode,
      pointerId: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      dayIndex,
      start,
      end: start + block.duration,
      pxPerMin: track.getBoundingClientRect().width / span,
      rowHeight: row.getBoundingClientRect().height,
      moved: false,
      preview: { dayIndex, start, end: start + block.duration },
    }

    // Listen on the window, not the block. A block dragged into another row is
    // re-rendered there, which unmounts the element the pointer went down on;
    // element pointer capture dies with it, and the release would never arrive.
    const onMove = (ev: globalThis.PointerEvent) => move(ev)
    const onUp = (ev: globalThis.PointerEvent) => {
      detach()
      end(ev)
    }
    const onCancel = () => {
      detach()
      cancel()
    }
    const detach = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
  }

  function move(e: PointerPoint) {
    const d = drag.current
    if (!d || d.pointerId !== e.pointerId) return
    const dx = e.clientX - d.x
    const dy = e.clientY - d.y
    if (!d.moved && Math.hypot(dx, dy) < 4) return
    d.moved = true

    const minuteDelta = Math.round(dx / d.pxPerMin / SNAP) * SNAP
    if (d.mode === 'move') {
      const duration = d.end - d.start
      const dayIndex = Math.min(days.length - 1, Math.max(0, d.dayIndex + Math.round(dy / d.rowHeight)))
      const start = Math.min(viewEnd - duration, Math.max(viewStart, d.start + minuteDelta))
      d.preview = { dayIndex, start, end: start + duration }
    } else {
      const end = Math.min(viewEnd, Math.max(d.start + SNAP, d.end + minuteDelta))
      d.preview = { dayIndex: d.dayIndex, start: d.start, end }
    }
    setPreview({ key: d.key, ...d.preview })
  }

  function end(e: PointerPoint) {
    const d = drag.current
    if (!d || d.pointerId !== e.pointerId) return
    drag.current = null
    setPreview(null)
    if (!d.moved) return
    suppressClick.current = true
    onSelect(d.key)
    const { dayIndex, start, end: finish } = d.preview
    if (dayIndex !== d.dayIndex || start !== d.start || finish !== d.end) {
      onMove(d.key, days[dayIndex], start, finish)
    }
  }

  function cancel() {
    drag.current = null
    setPreview(null)
  }

  function onKey(e: KeyboardEvent<HTMLButtonElement>, block: DraftBlock, dayIndex: number) {
    const start = minutesOfDay(block.startsAt)
    const finish = start + block.duration
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault()
      onRemove(block.key)
      return
    }
    let next: [number, number, number] | null = null
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      const step = e.key === 'ArrowLeft' ? -SNAP : SNAP
      next = e.shiftKey
        ? [dayIndex, start, Math.min(24 * 60, Math.max(start + SNAP, finish + step))]
        : [dayIndex, Math.max(0, Math.min(24 * 60 - block.duration, start + step)), 0]
      if (!e.shiftKey) next[2] = next[1] + block.duration
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const target = dayIndex + (e.key === 'ArrowUp' ? -1 : 1)
      if (target >= 0 && target < days.length) next = [target, start, finish]
    }
    if (next) {
      e.preventDefault()
      onMove(block.key, days[next[0]], next[1], next[2])
    }
  }

  return (
    <div className="plan-timeline" role="application" aria-label="Plan timeline. Drag blocks to change their day or time.">
      <div className="tl-head">
        <div className="tl-label tl-corner">Day</div>
        <div className="tl-axis" aria-hidden="true">
          {hours.map((h, i) => (
            <span
              key={h}
              className={i === 0 ? 'is-first' : i === hours.length - 1 ? 'is-last' : undefined}
              style={{ left: pct(h) }}
            >
              {hhmm(h)}
            </span>
          ))}
        </div>
      </div>

      {days.map((date, dayIndex) => {
        const weekday = parseISO(date).getDay()
        const rowBlocks = blocks.filter((b) => b.date === date && b.key !== preview?.key)
        const dragged = preview && preview.dayIndex === dayIndex ? blocks.find((b) => b.key === preview.key) : undefined
        const dayDeadlines = deadlines.filter((d) => d.date === date)
        const minutes = blocks.filter((b) => b.date === date).reduce((sum, b) => sum + b.duration, 0)

        return (
          <div
            key={date}
            ref={dayIndex === 0 ? rowRef : undefined}
            className={`tl-row${studyDays.includes(weekday) ? '' : ' is-rest'}${date === todayISO ? ' is-today' : ''}`}
          >
            <div className="tl-label">
              <span className="tl-date">{DAY_LABEL.format(parseISO(date))}</span>
              <span className="tl-sum tnum">{minutes > 0 ? `${Math.floor(minutes / 60)}h${minutes % 60 ? ` ${minutes % 60}m` : ''}` : studyDays.includes(weekday) ? 'free' : 'rest day'}</span>
              {dayDeadlines.map((d) => (
                <span
                  key={d.itemId}
                  className="tl-deadline"
                  style={{ ['--event-color' as string]: d.color }}
                  title={`${ITEM_LABELS[d.type].label} due: ${d.title}`}
                >
                  <i className={`bi ${d.type === 'EXAM' ? 'bi-mortarboard-fill' : 'bi-flag-fill'}`} aria-hidden="true" />
                  <span className="text-truncate">{d.title}</span>
                </span>
              ))}
            </div>

            <div
              ref={dayIndex === 0 ? trackRef : undefined}
              className="tl-track"
              style={{ ['--tl-hours' as string]: span / 60 }}
              onClick={(e) => {
                if (e.target === e.currentTarget) onSelect(null)
              }}
            >
              <span
                className="tl-window"
                style={{ left: pct(Math.max(viewStart, studyWindow.start)), width: `${((Math.min(viewEnd, studyWindow.end) - Math.max(viewStart, studyWindow.start)) / span) * 100}%` }}
                aria-hidden="true"
              />

              {busy
                .filter((b) => b.date === date)
                .map((b) => (
                  <span
                    key={b.key}
                    className="tl-busy"
                    style={{ left: pct(Math.max(viewStart, b.start)), width: `${((Math.min(viewEnd, b.end) - Math.max(viewStart, b.start)) / span) * 100}%` }}
                    title={`Busy: ${b.title} ${hhmm(b.start)}–${hhmm(b.end)}`}
                  >
                    <span className="text-truncate">{b.title}</span>
                  </span>
                ))}

              {date === todayISO && nowMinutes > viewStart && nowMinutes < viewEnd && (
                <span className="tl-now" style={{ left: pct(nowMinutes) }} aria-hidden="true" />
              )}

              {[...rowBlocks, ...(dragged ? [dragged] : [])].map((block) => {
                const isPreview = Boolean(dragged && block.key === dragged.key)
                const start = isPreview ? preview!.start : minutesOfDay(block.startsAt)
                const finish = isPreview ? preview!.end : start + block.duration
                const problem = issues.get(block.key)
                const tone = problem?.clash || problem?.overlap || problem?.past ? ' is-error' : problem?.late || problem?.outside ? ' is-warn' : ''
                const label = `${block.title}, ${DAY_LABEL.format(parseISO(block.date))} ${hhmm(start)} to ${hhmm(finish)}`

                // The dragged copy gets no tooltip: it is moving under the pointer.
                const tipContent = isPreview
                  ? null
                  : block.moved
                    ? { heading: `Moved to ${hhmm(start)}`, text: 'You moved this block, so the planner’s reasoning no longer applies.', muted: true }
                    : block.reason
                      ? { heading: `Why ${hhmm(start)}`, text: block.reason }
                      : null

                return (
                  <div
                    key={block.key}
                    className={`tl-block${tone}${isPreview ? ' is-dragging' : ''}${selectedKey === block.key ? ' is-selected' : ''}`}
                    style={{ left: pct(start), width: `${((finish - start) / span) * 100}%`, ['--event-color' as string]: block.subjectColor }}
                    {...reasonTip.bind(block.key, tipContent)}
                  >
                    <button
                      type="button"
                      className="tl-block-main"
                      onPointerDown={(e) => begin(e, block, dayIndex, 'move')}
                      onClick={() => {
                        if (suppressClick.current) {
                          suppressClick.current = false
                          return
                        }
                        onSelect(block.key)
                      }}
                      onKeyDown={(e) => onKey(e, block, dayIndex)}
                      aria-label={`${label}${block.itemTitle ? `, ${block.subjectName}` : ''}. Arrow keys move it, Shift with left or right resizes, Delete removes it.`}
                    >
                      <span className="tl-block-time tnum">
                        {block.itemType && <i className={`bi ${ITEM_LABELS[block.itemType].icon} me-1`} aria-hidden="true" />}
                        {hhmm(start)}
                      </span>
                      <span className="tl-block-title">{block.itemTitle ?? block.subjectName}</span>
                    </button>
                    <span
                      className="tl-resize"
                      onPointerDown={(e) => begin(e, block, dayIndex, 'resize')}
                      aria-hidden="true"
                    />
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
      {reasonTip.node}
    </div>
  )
}
