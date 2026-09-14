import type { Metadata } from 'next'
import Link from 'next/link'
import { listEventsInRange } from '@/lib/data/schedule'
import { listSubjects } from '@/lib/data/subjects'
import { EventList } from '@/components/schedule/EventList'
import { NewEventButton } from '@/components/schedule/NewEventButton'
import { GenerateScheduleButton } from '@/components/schedule/GenerateScheduleButton'
import { TimeGrid, type GridDay } from '@/components/schedule/TimeGrid'
import { EmptyState } from '@/components/dashboard/EmptyState'
import {
  addDays,
  formatDay,
  formatLongDay,
  isSameDay,
  startOfWeek,
  toDateInput,
} from '@/lib/format'

export const metadata: Metadata = { title: 'Schedule' }
export const dynamic = 'force-dynamic'

/** Longest range the planner offers, in days from its first plannable day. */
const PLANNER_HORIZON_DAYS = 28

type View = 'week' | 'day' | 'list'

const VIEWS: { id: View; label: string; icon: string }[] = [
  { id: 'week', label: 'Week', icon: 'bi-calendar3-week' },
  { id: 'day', label: 'Day', icon: 'bi-calendar-day' },
  { id: 'list', label: 'List', icon: 'bi-list-ul' },
]

const WEEKDAY = new Intl.DateTimeFormat('en-GB', { weekday: 'short' })

/**
 * The schedule as an hour-by-hour week, a single day, or the day-by-day list.
 *
 * `?week=` and `?day=` are integer offsets from the current week and today
 * rather than dates, so the values cannot be used to probe arbitrary ranges
 * and there is nothing to validate beyond "is it a number".
 */
export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string; day?: string; view?: string }>
}) {
  const params = await searchParams
  const view: View = params.view === 'day' || params.view === 'list' ? params.view : 'week'
  const dayOffset = Number.parseInt(params.day ?? '0', 10) || 0

  const now = new Date()
  const todayStart = new Date(now)
  todayStart.setHours(0, 0, 0, 0)
  const selectedDay = addDays(todayStart, dayOffset)

  // Day view navigates by day, so its week is whichever week holds that day.
  const offset =
    view === 'day'
      ? Math.round((startOfWeek(selectedDay).getTime() - startOfWeek(now).getTime()) / (7 * 86_400_000))
      : Number.parseInt(params.week ?? '0', 10) || 0

  const weekStart = addDays(startOfWeek(now), offset * 7)
  const weekEnd = addDays(weekStart, 7)

  // The planner offers ranges up to four weeks, and it can only avoid a clash it
  // can see. Reading the whole horizon in one query costs the same index scan as
  // reading the visible week, so the week view slices this rather than
  // re-querying.
  const planStart = weekStart > todayStart ? weekStart : todayStart
  const horizonEnd = addDays(planStart, PLANNER_HORIZON_DAYS)

  const [horizonEvents, subjects] = await Promise.all([
    listEventsInRange(weekStart, horizonEnd),
    listSubjects(),
  ])

  const events = horizonEvents.filter(
    (event) => event.startsAt < weekEnd && event.endsAt > weekStart,
  )

  const subjectOptions = subjects.map((s) => ({
    id: s.id,
    name: s.name,
    category: s.category,
    colorHex: s.colorHex,
  }))

  // Serializable data for the smart scheduling preview (client-side engine)
  const schedulingSubjects = subjects.map((s) => ({
    id: s.id,
    name: s.name,
    category: s.category,
    colorHex: s.colorHex,
    difficulty: s.difficulty,
    examDate: s.examDate?.toISOString() ?? null,
  }))

  const schedulingEvents = horizonEvents.map((e) => ({
    id: e.id,
    subjectId: e.subject?.id ?? null,
    startsAt: e.startsAt.toISOString(),
    endsAt: e.endsAt.toISOString(),
    isAllDay: e.isAllDay,
    status: e.status,
    isGenerated: e.generatedAt !== null,
  }))

  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))

  const gridDates = view === 'day' ? [selectedDay] : days
  const gridDays: GridDay[] = gridDates.map((day) => ({
    iso: toDateInput(day),
    weekday: WEEKDAY.format(day),
    dayNumber: String(day.getDate()),
    label: formatLongDay(day),
    isToday: isSameDay(day, now),
  }))
  const gridEvents =
    view === 'day'
      ? events.filter((e) => e.startsAt < addDays(selectedDay, 1) && e.endsAt > selectedDay)
      : events

  const href = (next: { view?: View; week?: number; day?: number }) => {
    const v = next.view ?? view
    const query = new URLSearchParams()
    if (v !== 'week') query.set('view', v)
    if (v === 'day' && next.day) query.set('day', String(next.day))
    if (v !== 'day' && next.week) query.set('week', String(next.week))
    const qs = query.toString()
    return `/dashboard/schedule${qs ? `?${qs}` : ''}`
  }

  const isCurrent = view === 'day' ? dayOffset === 0 : offset === 0
  // Switching to Day from another week lands on that week's Monday, not today.
  const dayForWeek =
    offset === 0 ? 0 : Math.round((weekStart.getTime() - todayStart.getTime()) / 86_400_000)

  return (
    <>
      <header className="d-flex flex-wrap align-items-center justify-content-between gap-3 mb-4">
        <div>
          <h1 className="h3 fw-semibold mb-1">Schedule</h1>
          <p className="text-secondary mb-0">
            {view === 'day'
              ? formatLongDay(selectedDay)
              : `${formatDay(weekStart)} to ${formatDay(addDays(weekEnd, -1))}`}
          </p>
        </div>

        <div className="d-flex flex-wrap align-items-center gap-2">
          <nav className="btn-group" aria-label="Schedule view">
            {VIEWS.map((option) => (
              <Link
                key={option.id}
                href={href({
                  view: option.id,
                  week: option.id === 'day' ? undefined : offset,
                  day: option.id === 'day' ? (view === 'day' ? dayOffset : dayForWeek) : undefined,
                })}
                className={`btn btn-sm ${view === option.id ? 'btn-secondary' : 'btn-outline-secondary'}`}
                aria-current={view === option.id ? 'page' : undefined}
              >
                <i className={`bi ${option.icon} me-1`} aria-hidden="true" />
                {option.label}
              </Link>
            ))}
          </nav>

          <div className="btn-group" role="group" aria-label={view === 'day' ? 'Change day' : 'Change week'}>
            <Link
              href={view === 'day' ? href({ day: dayOffset - 1 }) : href({ week: offset - 1 })}
              className="btn btn-outline-secondary btn-sm"
              aria-label={view === 'day' ? 'Previous day' : 'Previous week'}
            >
              <i className="bi bi-chevron-left" aria-hidden="true" />
            </Link>
            {!isCurrent && (
              <Link href={href({ week: 0, day: 0 })} className="btn btn-outline-secondary btn-sm">
                Today
              </Link>
            )}
            <Link
              href={view === 'day' ? href({ day: dayOffset + 1 }) : href({ week: offset + 1 })}
              className="btn btn-outline-secondary btn-sm"
              aria-label={view === 'day' ? 'Next day' : 'Next week'}
            >
              <i className="bi bi-chevron-right" aria-hidden="true" />
            </Link>
          </div>

          <GenerateScheduleButton
            subjects={schedulingSubjects}
            events={schedulingEvents}
            weekStartISO={weekStart.toISOString()}
          />

          <NewEventButton
            subjects={subjectOptions}
            defaultDateISO={(view === 'day' ? selectedDay : weekStart).toISOString()}
            className="btn btn-primary btn-sm"
          />
        </div>
      </header>

      {view !== 'list' ? (
        <>
          {subjects.length === 0 && (
            <div className="alert alert-light border small d-flex align-items-center justify-content-between gap-3">
              <span>
                Add subjects with exam dates and difficulty to let Generate build a study plan
                into this calendar.
              </span>
              <Link href="/dashboard/subjects" className="btn btn-sm btn-outline-primary flex-shrink-0">
                Manage subjects
              </Link>
            </div>
          )}
          <TimeGrid days={gridDays} events={gridEvents} subjects={subjectOptions} />
        </>
      ) : subjects.length === 0 && events.length === 0 ? (
        <div className="card">
          <EmptyState
            icon="bi-collection"
            title="Add a subject first"
            description="Subjects are the recurring commitments a schedule is built from: a module, a client, or a standing block of focus time."
            action={
              <Link href="/dashboard/subjects" className="btn btn-primary btn-sm">
                Manage subjects
              </Link>
            }
          />
        </div>
      ) : (
        <div className="d-flex flex-column gap-3">
          {days.map((day) => {
            const dayEvents = events.filter((event) => isSameDay(event.startsAt, day))
            const today = isSameDay(day, now)

            return (
              <section
                key={day.toISOString()}
                className={`card${today ? ' border-primary' : ''}`}
                aria-label={formatDay(day)}
              >
                <div className="card-header bg-transparent d-flex align-items-center justify-content-between">
                  <h2 className={`h6 fw-semibold mb-0${today ? ' text-primary' : ''}`}>
                    {formatDay(day)}
                    {today && <span className="badge text-bg-primary ms-2">Today</span>}
                  </h2>

                  <NewEventButton
                    subjects={subjectOptions}
                    defaultDateISO={day.toISOString()}
                    label="Add"
                    className="btn btn-sm btn-outline-secondary"
                  />
                </div>

                {dayEvents.length === 0 ? (
                  <div className="card-body py-3">
                    <p className="text-secondary small mb-0">Nothing scheduled.</p>
                  </div>
                ) : (
                  <EventList events={dayEvents} subjects={subjectOptions} editable />
                )}
              </section>
            )
          })}
        </div>
      )}
    </>
  )
}
