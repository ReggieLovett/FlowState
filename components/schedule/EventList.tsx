import { CATEGORY_META } from '@/lib/categories'
import type { ScheduleEventDTO } from '@/lib/data/schedule'
import { formatRange } from '@/lib/format'
import { deleteEventAction, setEventStatusAction } from '@/lib/actions/schedule'
import { EditEventButton } from './EditEventButton'
import type { SubjectOption } from './EventFormModal'

/**
 * Rows for a single day.
 *
 * Status changes and deletion are plain forms posting Server Actions, so they
 * work without JavaScript and cannot be redirected at another user's rows: the
 * actions resolve the owner from the session.
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
              <form action={setEventStatusAction}>
                <input type="hidden" name="id" value={event.id} />
                <input
                  type="hidden"
                  name="status"
                  value={done ? 'SCHEDULED' : 'COMPLETED'}
                />
                <button
                  type="submit"
                  className={`btn btn-sm ${done ? 'btn-success' : 'btn-outline-secondary'}`}
                  aria-label={done ? `Reopen ${event.title}` : `Mark ${event.title} done`}
                  title={done ? 'Mark as not done' : 'Mark as done'}
                >
                  <i className="bi bi-check-lg" aria-hidden="true" />
                </button>
              </form>

              {editable && <EditEventButton event={event} subjects={subjects} />}

              <form action={deleteEventAction}>
                <input type="hidden" name="id" value={event.id} />
                <button
                  type="submit"
                  className="btn btn-sm btn-outline-secondary"
                  aria-label={`Delete ${event.title}`}
                  title="Delete"
                >
                  <i className="bi bi-trash3" aria-hidden="true" />
                </button>
              </form>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
