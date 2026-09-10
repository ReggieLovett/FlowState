'use client'

import { useState } from 'react'
import { EventFormModal, type SubjectOption } from './EventFormModal'

export function NewEventButton({
  subjects,
  defaultDateISO,
  label = 'New event',
  className = 'btn btn-primary',
}: {
  subjects: SubjectOption[]
  /** ISO string, because a Date cannot cross the server/client boundary as a prop. */
  defaultDateISO?: string
  label?: string
  className?: string
}) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>
        <i className="bi bi-plus-lg me-1" aria-hidden="true" />
        {label}
      </button>

      {open && (
        <EventFormModal
          open={open}
          onClose={() => setOpen(false)}
          subjects={subjects}
          defaultDate={defaultDateISO ? new Date(defaultDateISO) : undefined}
        />
      )}
    </>
  )
}
