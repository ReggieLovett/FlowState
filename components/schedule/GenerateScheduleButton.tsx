'use client'

import { useState } from 'react'
import { GenerateScheduleDialog } from './GenerateScheduleDialog'
import type { Category } from '@prisma/client'

export interface SchedulingSubject {
  id: string
  name: string
  category: Category
  colorHex: string
  difficulty: number
  examDate: string | null
}

export interface SchedulingEvent {
  id: string
  subjectId: string | null
  startsAt: string
  endsAt: string
  isAllDay: boolean
  status: string
}

export function GenerateScheduleButton({
  subjects,
  events,
  weekStartISO,
}: {
  subjects: SchedulingSubject[]
  events: SchedulingEvent[]
  weekStartISO: string
}) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        className="btn btn-outline-primary btn-sm"
        onClick={() => setOpen(true)}
        disabled={subjects.length === 0}
        title={subjects.length === 0 ? 'Add a subject first' : 'Smart schedule'}
      >
        <i className="bi bi-magic me-1" aria-hidden="true" />
        Generate
      </button>

      <GenerateScheduleDialog
        open={open}
        onClose={() => setOpen(false)}
        subjects={subjects}
        events={events}
        weekStartISO={weekStartISO}
      />
    </>
  )
}
