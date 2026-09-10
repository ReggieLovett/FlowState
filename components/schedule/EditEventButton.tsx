'use client'

import { useState } from 'react'
import type { ScheduleEventDTO } from '@/lib/data/schedule'
import { EventFormModal, type SubjectOption } from './EventFormModal'

/** Opens the edit dialog for one event. Client island inside a server-rendered list. */
export function EditEventButton({
  event,
  subjects,
}: {
  event: ScheduleEventDTO
  subjects: SubjectOption[]
}) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        className="btn btn-sm btn-outline-secondary"
        onClick={() => setOpen(true)}
        aria-label={`Edit ${event.title}`}
        title="Edit"
      >
        <i className="bi bi-pencil" aria-hidden="true" />
      </button>

      {open && (
        <EventFormModal
          open={open}
          onClose={() => setOpen(false)}
          subjects={subjects}
          event={event}
        />
      )}
    </>
  )
}
