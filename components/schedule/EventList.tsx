import { CATEGORY_META } from '@/lib/categories'
import type { ScheduleEventDTO } from '@/lib/data/schedule'
import { formatRange } from '@/lib/format'
import { deleteEventAction } from '@/lib/actions/schedule'
import { ActionForm } from '@/components/feedback/ActionForm'
import { CompleteToggle } from './CompleteToggle'
import { EditEventButton } from './EditEventButton'
import type { SubjectOption } from './EventFormModal'

/**
 * Rows for a single day.
 *
 * Status changes and deletion are forms posting Server Actions, so they work
 * without JavaScript and cannot be redirected at another user's rows: the
 * actions resolve the owner from the session. The tick is a small client island
 * on top of that form so it can announce the XP it earned.
 */
export function EventList({
  events,
  subjects = [],
  editable = false,
}: {
  events: ScheduleEventDTO[]
  subjects?: SubjectOption[]
  editable?: boolean
}) {
  return (
    <ul className="list-group list-group-flush">
      {events.map((event) => {
        const meta = CATEGORY_META[event.category]
        const color = event.subject?.colorHex ?? meta.colorHex
        const done = event.status === 'COMPLETED'
        const cancelled = event.status === 'CANCELLED'

        return (
          <li
            key={event.id}
            className="list-group-item event-row bg-transparent d-flex align-items-center gap-3 py-3"
            style={{ ['--event-color' as string]: color }}
          >
            <div className="flex-grow-1 min-width-0">
              <div className="d-flex align-items-center gap-2 flex-wrap">
                <span
                  className={`fw-medium text-truncate${
                    cancelled ? ' text-decoration-line-through text-secondary' : ''
                  }`}
                >
                  {event.title}
                </span>
                <span className="chip">{meta.label}</span>
                {done && (
                  <span className="badge text-bg-success fw-normal">
                    <i className="bi bi-check-lg me-1" aria-hidden="true" />
                    Done
                  </span>
                )}
              </div>

              <div className="text-secondary small tnum mt-1 d-flex flex-wrap gap-2">
                <span>{formatRange(event.startsAt, event.endsAt, event.isAllDay)}</span>
                {event.subject && <span>· {event.subject.name}</span>}
                {event.location && (
                  <span>
                    · <i className="bi bi-geo-alt" aria-hidden="true" /> {event.location}
                  </span>
                )}
              </div>
            </div>

            <div className="d-flex align-items-center gap-1 flex-shrink-0">
              {/* Same button as before; now reports the XP it earned. */}
              <CompleteToggle id={event.id} title={event.title} done={done} />

              {editable && <EditEventButton event={event} subjects={subjects} />}

              <ActionForm action={deleteEventAction}>
                <input type="hidden" name="id" value={event.id} />
                <button
                  type="submit"
                  className="btn btn-sm btn-outline-secondary"
                  aria-label={`Delete ${event.title}`}
                  title="Delete"
                >
                  <i className="bi bi-trash3" aria-hidden="true" />
                </button>
              </ActionForm>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
