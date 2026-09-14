'use client'

import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
  type KeyboardEvent,
  type PointerEvent,
} from 'react'
import Link from 'next/link'
import { CATEGORY_META } from '@/lib/categories'
import { ITEM_LABELS, type ItemKind } from '@/lib/scheduling'
import { moveEventAction } from '@/lib/actions/schedule'
import type { ScheduleEventDTO } from '@/lib/data/schedule'
import { CompleteToggle } from './CompleteToggle'
import { EventFormModal, type SubjectOption } from './EventFormModal'

/**
 * Hour-by-hour calendar for one day or a week.
 *
 * Restores the original spec's "Task & Time Management" view: colour-coded
 * blocks on a time axis, drag to reschedule, drag the bottom edge to resize,
 * click empty time to add, click a block to edit, tick to complete.
 *
 * Blocks are positioned in the browser's timezone, which is the one the user
 * is dragging in, so the event layer mounts after hydration rather than
 * risking a server-rendered position that disagrees with the client's.
 */

/** An item deadline, drawn in the all-day row of its day. */
export interface GridDeadline {
  itemId: string
  subjectId: string
  /** Local YYYY-MM-DD. */
  date: string
  title: string
  type: ItemKind
  color: string
  done: boolean
}

export interface GridDay {
  /** Local YYYY-MM-DD. */
  iso: string
  weekday: string
  dayNumber: string
  label: string
  isToday: boolean
}

const HOUR_PX = 48
const PX_PER_MIN = HOUR_PX / 60
const SNAP = 15
const DAY_MIN = 24 * 60

const TIME = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' })

function dayDate(iso: string, minutes = 0): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d, 0, minutes)
}

function minutesLabel(minutes: number) {
  return TIME.format(dayDate('2000-01-01', minutes))
}

const noopSubscribe = () => () => {}
function subscribeMinute(callback: () => void) {
  const timer = window.setInterval(callback, 30_000)
  return () => window.clearInterval(timer)
}

interface Segment {
  event: ScheduleEventDTO
  start: number
  end: number
  lane: number
  lanes: number
  /** Starts and ends on this day, so it can be dragged. */
  movable: boolean
}

/** Greedy interval partitioning: overlapping blocks share a cluster's width. */
function layoutDay(items: Omit<Segment, 'lane' | 'lanes'>[]): Segment[] {
  const sorted = [...items].sort((a, b) => a.start - b.start || b.end - a.end)
  const out: Segment[] = []
  let cluster: Segment[] = []
  let laneEnds: number[] = []
  let clusterEnd = -1

  const flush = () => {
    for (const s of cluster) s.lanes = laneEnds.length
    out.push(...cluster)
    cluster = []
    laneEnds = []
  }

  for (const item of sorted) {
    if (item.start >= clusterEnd && cluster.length > 0) flush()
    let lane = laneEnds.findIndex((end) => end <= item.start)
    if (lane === -1) {
      lane = laneEnds.length
      laneEnds.push(item.end)
    } else {
      laneEnds[lane] = item.end
    }
    cluster.push({ ...item, lane, lanes: 1 })
    clusterEnd = Math.max(clusterEnd, item.end)
  }
  flush()
  return out
}

/** The fields a drag reads, shared by React's and the DOM's pointer events. */
type PointerPoint = { clientX: number; clientY: number; pointerId: number }

interface DragState {
  id: string
  mode: 'move' | 'resize'
  pointerId: number
  originX: number
  originY: number
  dayIndex: number
  start: number
  end: number
  colWidth: number
  moved: boolean
  event: ScheduleEventDTO
  preview: { dayIndex: number; start: number; end: number }
}

interface Override {
  /** The server times this override was made against. */
  from: string
  startsAt: Date
  endsAt: Date
}

const keyOf = (e: ScheduleEventDTO) => `${e.startsAt.toISOString()}|${e.endsAt.toISOString()}`

export function TimeGrid({
  days,
  events,
  subjects,
  deadlines = [],
}: {
  days: GridDay[]
  events: ScheduleEventDTO[]
  subjects: SubjectOption[]
  deadlines?: GridDeadline[]
}) {
  const mounted = useSyncExternalStore(noopSubscribe, () => true, () => false)
  const minuteTick = useSyncExternalStore(
    subscribeMinute,
    () => Math.floor(Date.now() / 60_000),
    () => 0,
  )

  const scrollRef = useRef<HTMLDivElement>(null)
  const columnRefs = useRef<(HTMLDivElement | null)[]>([])
  const dragRef = useRef<DragState | null>(null)
  const suppressClick = useRef(false)

  const [preview, setPreview] = useState<{ id: string; dayIndex: number; start: number; end: number } | null>(null)
  const [overrides, setOverrides] = useState<Record<string, Override>>({})
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<ScheduleEventDTO | null>(null)
  const [creating, setCreating] = useState<Date | null>(null)
  const [, startTransition] = useTransition()

  // Open on the working day rather than at midnight.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const timed = events.filter((e) => !e.isAllDay)
    const earliest = timed.length
      ? Math.min(...timed.map((e) => e.startsAt.getHours()))
      : 8
    el.scrollTop = Math.max(0, Math.min(earliest, 8) - 1) * HOUR_PX
    // Only on first mount: re-scrolling after every save would yank the view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Apply optimistic moves until the server's copy catches up. An override
  // is ignored as soon as the event's server times differ from the times it
  // was made against, so there is nothing to clean up.
  const effective = events.map((event) => {
    const o = overrides[event.id]
    return o && o.from === keyOf(event) ? { ...event, startsAt: o.startsAt, endsAt: o.endsAt } : event
  })

  const allDayByDay = days.map((day) =>
    effective.filter((e) => {
      if (!e.isAllDay) return false
      return e.startsAt < dayDate(day.iso, DAY_MIN) && e.endsAt > dayDate(day.iso)
    }),
  )

  const segmentsByDay = days.map((day) => {
    const dayStart = dayDate(day.iso)
    const dayEnd = dayDate(day.iso, DAY_MIN)
    const items = effective
      .filter((e) => !e.isAllDay && e.startsAt < dayEnd && e.endsAt > dayStart)
      .map((event) => {
        const start = Math.max(0, (event.startsAt.getTime() - dayStart.getTime()) / 60_000)
        const end = Math.min(DAY_MIN, (event.endsAt.getTime() - dayStart.getTime()) / 60_000)
        return {
          event,
          start,
          end: Math.max(end, start + 1),
          movable: event.startsAt >= dayStart && event.endsAt <= dayEnd,
        }
      })
    return layoutDay(items)
  })

  function commit(event: ScheduleEventDTO, dayIndex: number, start: number, end: number) {
    const startsAt = dayDate(days[dayIndex].iso, start)
    const endsAt = dayDate(days[dayIndex].iso, end)
    if (startsAt.getTime() === event.startsAt.getTime() && endsAt.getTime() === event.endsAt.getTime()) return

    setError(null)
    const original = events.find((e) => e.id === event.id) ?? event
    setOverrides((current) => ({ ...current, [event.id]: { from: keyOf(original), startsAt, endsAt } }))

    startTransition(async () => {
      const result = await moveEventAction({
        id: event.id,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
      })
      if (result.error) {
        setError(result.error)
        setOverrides((current) => {
          const next = { ...current }
          delete next[event.id]
          return next
        })
      }
    })
  }

  function beginDrag(
    e: PointerEvent<HTMLElement>,
    segment: Segment,
    dayIndex: number,
    mode: 'move' | 'resize',
  ) {
    // Touch keeps its native meaning, scrolling the grid. A tap still opens
    // the editor, which can change the time, so nothing is out of reach.
    if (e.button !== 0 || !segment.movable || e.pointerType === 'touch') return
    const column = columnRefs.current[dayIndex]
    if (!column) return
    if (mode === 'resize') e.stopPropagation()

    dragRef.current = {
      id: segment.event.id,
      mode,
      pointerId: e.pointerId,
      originX: e.clientX,
      originY: e.clientY,
      dayIndex,
      start: segment.start,
      end: segment.end,
      colWidth: column.getBoundingClientRect().width,
      moved: false,
      event: segment.event,
      preview: { dayIndex, start: segment.start, end: segment.end },
    }

    // Track the pointer on the window for the rest of the gesture. The dragged
    // block is re-rendered as a preview (in another column, for a day change),
    // which unmounts the element the pointer went down on and releases its
    // pointer capture. Element listeners then only saw moves while the cursor
    // happened to be over the preview, and a release anywhere else left the
    // drag stuck.
    const onMove = (ev: globalThis.PointerEvent) => moveDrag(ev)
    const onUp = (ev: globalThis.PointerEvent) => {
      detach()
      endDrag(ev)
    }
    const onCancel = () => {
      detach()
      cancelDrag()
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

  function moveDrag(e: PointerPoint) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== e.pointerId) return

    const dx = e.clientX - drag.originX
    const dy = e.clientY - drag.originY
    if (!drag.moved && Math.hypot(dx, dy) < 5) return
    drag.moved = true

    const delta = Math.round(dy / PX_PER_MIN / SNAP) * SNAP
    let next = drag.preview

    if (drag.mode === 'move') {
      const duration = drag.end - drag.start
      const dayShift = days.length > 1 ? Math.round(dx / drag.colWidth) : 0
      const dayIndex = Math.min(days.length - 1, Math.max(0, drag.dayIndex + dayShift))
      const start = Math.min(DAY_MIN - duration, Math.max(0, Math.round((drag.start + delta) / SNAP) * SNAP))
      next = { dayIndex, start, end: start + duration }
    } else {
      const end = Math.min(DAY_MIN, Math.max(drag.start + SNAP, Math.round((drag.end + delta) / SNAP) * SNAP))
      next = { dayIndex: drag.dayIndex, start: drag.start, end }
    }

    drag.preview = next
    setPreview({ id: drag.id, ...next })
  }

  function endDrag(e: PointerPoint) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== e.pointerId) return
    dragRef.current = null
    setPreview(null)
    if (!drag.moved) return

    // The pointerup of a drag is followed by a click; it must not open the editor.
    suppressClick.current = true
    commit(drag.event, drag.preview.dayIndex, drag.preview.start, drag.preview.end)
  }

  function cancelDrag() {
    dragRef.current = null
    setPreview(null)
  }

  function onBlockKey(e: KeyboardEvent<HTMLButtonElement>, segment: Segment, dayIndex: number) {
    if (!e.altKey || !segment.movable) return
    const { start, end } = segment
    let next: [number, number, number] | null = null

    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const step = e.key === 'ArrowUp' ? -SNAP : SNAP
      next = e.shiftKey
        ? [dayIndex, start, Math.min(DAY_MIN, Math.max(start + SNAP, end + step))]
        : [dayIndex, Math.max(0, Math.min(DAY_MIN - (end - start), start + step)), 0]
      if (!e.shiftKey) next[2] = next[1] + (end - start)
    } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && days.length > 1) {
      const target = dayIndex + (e.key === 'ArrowLeft' ? -1 : 1)
      if (target >= 0 && target < days.length) next = [target, start, end]
    }

    if (next) {
      e.preventDefault()
      commit(segment.event, next[0], next[1], next[2])
    }
  }

  function onColumnClick(e: React.MouseEvent<HTMLDivElement>, dayIndex: number) {
    if (e.target !== e.currentTarget) return
    const rect = e.currentTarget.getBoundingClientRect()
    const minutes = Math.floor((e.clientY - rect.top) / PX_PER_MIN / 30) * 30
    setCreating(dayDate(days[dayIndex].iso, Math.min(DAY_MIN - 60, Math.max(0, minutes))))
  }

  const nowDate = new Date(minuteTick * 60_000)
  const nowMinutes = nowDate.getHours() * 60 + nowDate.getMinutes()

  function renderBlock(segment: Segment, dayIndex: number, override?: { start: number; end: number }) {
    const { event } = segment
    const start = override?.start ?? segment.start
    const end = override?.end ?? segment.end
    const color = event.subject?.colorHex ?? CATEGORY_META[event.category].colorHex
    const done = event.status === 'COMPLETED'
    const cancelled = event.status === 'CANCELLED'
    const height = Math.max((end - start) * PX_PER_MIN, 22)
    const compact = height < 44
    const lanes = override ? 1 : segment.lanes
    const lane = override ? 0 : segment.lane
    const timeText = `${minutesLabel(start)}–${minutesLabel(end)}`

    return (
      <div
        key={override ? `${event.id}-preview` : event.id}
        className={`tg-block${done ? ' is-done' : ''}${cancelled ? ' is-cancelled' : ''}${override ? ' is-dragging' : ''}${compact ? ' is-compact' : ''}`}
        style={{
          top: start * PX_PER_MIN,
          height,
          left: `calc(${(lane / lanes) * 100}% + 2px)`,
          width: `calc(${100 / lanes}% - 4px)`,
          ['--event-color' as string]: color,
        }}
      >
        <button
          type="button"
          className="tg-block-main"
          onPointerDown={(e) => beginDrag(e, segment, dayIndex, 'move')}
          onClick={() => {
            if (suppressClick.current) {
              suppressClick.current = false
              return
            }
            setEditing(event)
          }}
          onKeyDown={(e) => onBlockKey(e, segment, dayIndex)}
          aria-label={`${event.title}, ${timeText}${done ? ', done' : ''}. Enter to edit${segment.movable ? '. Alt and arrow keys move it, add Shift to resize' : ''}.`}
          style={{ cursor: segment.movable ? 'grab' : 'pointer' }}
        >
          <span className="tg-block-time">
            {event.item ? (
              <i className={`bi ${ITEM_LABELS[event.item.type].icon} me-1`} aria-hidden="true" />
            ) : (
              event.generatedAt && <i className="bi bi-stars me-1" aria-hidden="true" />
            )}
            {compact ? minutesLabel(start) : timeText}
          </span>
          <span className="tg-block-title">{event.title}</span>
          {!compact && height >= 64 && event.subject && (
            <span className="tg-block-sub">{event.subject.name}</span>
          )}
        </button>

        {!override && !cancelled && (
          <span className="tg-block-check">
            <CompleteToggle id={event.id} title={event.title} done={done} compact />
          </span>
        )}

        {segment.movable && !override && (
          <span
            className="tg-resize"
            onPointerDown={(e) => beginDrag(e, segment, dayIndex, 'resize')}
            aria-hidden="true"
          />
        )}
      </div>
    )
  }

  const dragging = preview ? segmentsByDay.flat().find((s) => s.event.id === preview.id) : undefined

  return (
    <div className="card time-grid">
      {error && (
        <div className="alert alert-danger py-2 px-3 small m-3 mb-0" role="alert">
          {error}
        </div>
      )}

      <div className="time-grid-scroll" ref={scrollRef}>
        <div
          className={`time-grid-inner${days.length > 1 ? ' is-week' : ''}`}
          style={{ ['--tg-days' as string]: days.length }}
        >
          {/* Day headers and the all-day row stay pinned while hours scroll. */}
          <div className="tg-sticky">
          <div className="tg-head">
            <div className="tg-gutter" />
            {days.map((day) => (
              <div key={day.iso} className={`tg-dayhead${day.isToday ? ' is-today' : ''}`}>
                <span className="tg-weekday">{day.weekday}</span>
                <span className="tg-daynum">{day.dayNumber}</span>
              </div>
            ))}
          </div>

          {mounted && (allDayByDay.some((list) => list.length > 0) || deadlines.length > 0) && (
            <div className="tg-allday">
              <div className="tg-gutter tg-allday-label">All day</div>
              {allDayByDay.map((list, i) => (
                <div key={days[i].iso} className="tg-allday-cell">
                  {deadlines
                    .filter((d) => d.date === days[i].iso)
                    .map((d) => (
                      <Link
                        key={d.itemId}
                        href={`/dashboard/subjects#subject-${d.subjectId}`}
                        className={`tg-deadline${d.done ? ' is-done' : ''}`}
                        style={{ ['--event-color' as string]: d.color }}
                        title={`${ITEM_LABELS[d.type].label} ${d.type === 'EXAM' ? 'on' : 'due'} ${days[i].label}: ${d.title}`}
                      >
                        <i className={`bi ${d.type === 'EXAM' ? 'bi-mortarboard-fill' : 'bi-flag-fill'} me-1`} aria-hidden="true" />
                        {d.title}
                      </Link>
                    ))}
                  {list.map((event) => (
                    <button
                      key={event.id}
                      type="button"
                      className={`tg-allday-chip${event.status === 'COMPLETED' ? ' is-done' : ''}`}
                      style={{ ['--event-color' as string]: event.subject?.colorHex ?? CATEGORY_META[event.category].colorHex }}
                      onClick={() => setEditing(event)}
                    >
                      {event.title}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}
          </div>

          <div className="tg-body" style={{ height: 24 * HOUR_PX }}>
            <div className="tg-gutter tg-hours" aria-hidden="true">
              {Array.from({ length: 23 }, (_, i) => (
                <span key={i} style={{ top: (i + 1) * HOUR_PX }}>
                  {String(i + 1).padStart(2, '0')}:00
                </span>
              ))}
            </div>

            {days.map((day, dayIndex) => (
              <div
                key={day.iso}
                ref={(el) => {
                  columnRefs.current[dayIndex] = el
                }}
                className={`tg-col${day.isToday ? ' is-today' : ''}`}
                onClick={(e) => onColumnClick(e, dayIndex)}
                role="group"
                aria-label={`${day.label}. Click empty time to add an event.`}
              >
                {mounted &&
                  segmentsByDay[dayIndex]
                    .filter((segment) => segment.event.id !== preview?.id)
                    .map((segment) => renderBlock(segment, dayIndex))}

                {mounted && dragging && preview && preview.dayIndex === dayIndex &&
                  renderBlock(dragging, dayIndex, { start: preview.start, end: preview.end })}

                {mounted && minuteTick > 0 && day.isToday && (
                  <span className="tg-now" style={{ top: nowMinutes * PX_PER_MIN }} aria-hidden="true" />
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="tg-hint border-top px-3 py-2">
        <i className="bi bi-hand-index me-1" aria-hidden="true" />
        Drag a block to move it, drag its bottom edge to resize, or click empty time to add one.
      </div>

      {editing && (
        <EventFormModal open onClose={() => setEditing(null)} subjects={subjects} event={editing} />
      )}
      {creating && (
        <EventFormModal open onClose={() => setCreating(null)} subjects={subjects} defaultDate={creating} />
      )}
    </div>
  )
}
