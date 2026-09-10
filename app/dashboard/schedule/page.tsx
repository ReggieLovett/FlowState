import type { Metadata } from 'next'
import Link from 'next/link'
import { listEventsInRange } from '@/lib/data/schedule'
import { listSubjects } from '@/lib/data/subjects'
import { EventList } from '@/components/schedule/EventList'
import { NewEventButton } from '@/components/schedule/NewEventButton'
import { GenerateScheduleButton } from '@/components/schedule/GenerateScheduleButton'
import { EmptyState } from '@/components/dashboard/EmptyState'
import { addDays, formatDay, isSameDay, startOfWeek } from '@/lib/format'

export const metadata: Metadata = { title: 'Schedule' }
export const dynamic = 'force-dynamic'

/**
 * The week, as seven day sections.
 *
 * `?week=` is an integer offset from the current week rather than a date, so the
 * value cannot be used to probe arbitrary ranges and there is nothing to
 * validate beyond "is it a number".
 */
export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>
}) {
  const params = await searchParams
  const offset = Number.parseInt(params.week ?? '0', 10) || 0

  const now = new Date()
  const weekStart = addDays(startOfWeek(now), offset * 7)
  const weekEnd = addDays(weekStart, 7)

  const [events, subjects] = await Promise.all([
    listEventsInRange(weekStart, weekEnd),
    listSubjects(),
  ])

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

  const schedulingEvents = events.map((e) => ({
    id: e.id,
    subjectId: e.subject?.id ?? null,
    startsAt: e.startsAt.toISOString(),
    endsAt: e.endsAt.toISOString(),
    isAllDay: e.isAllDay,
    status: e.status,
  }))

  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))

  return (
    <>
      <header className="d-flex flex-wrap align-items-center justify-content-between gap-3 mb-4">
        <div>
          <h1 className="h3 fw-semibold mb-1">Schedule</h1>
          <p className="text-secondary mb-0">
            {formatDay(weekStart)} to {formatDay(addDays(weekEnd, -1))}
          </p>
        </div>

        <div className="d-flex align-items-center gap-2">
          <div className="btn-group" role="group" aria-label="Change week">
            <Link
              href={`/dashboard/schedule?week=${offset - 1}`}
              className="btn btn-outline-secondary btn-sm"
              aria-label="Previous week"
            >
              <i className="bi bi-chevron-left" aria-hidden="true" />
            </Link>
            {offset !== 0 && (
              <Link href="/dashboard/schedule" className="btn btn-outline-secondary btn-sm">
                Today
              </Link>
            )}
            <Link
              href={`/dashboard/schedule?week=${offset + 1}`}
              className="btn btn-outline-secondary btn-sm"
              aria-label="Next week"
            >
              <i className="bi bi-chevron-right" aria-hidden="true" />
            </Link>
          </div>

          <NewEventButton
            subjects={subjectOptions}
            defaultDateISO={weekStart.toISOString()}
            className="btn btn-primary btn-sm"
          />
        </div>
      </header>

      {subjects.length === 0 && events.length === 0 ? (
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
          <GenerateScheduleButton
            subjects={schedulingSubjects}
            events={schedulingEvents}
            weekStartISO={weekStart.toISOString()}
          />

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
