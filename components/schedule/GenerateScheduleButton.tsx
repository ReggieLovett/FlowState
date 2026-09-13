'use client'

import { useState } from 'react'
import {
  GenerateScheduleDialog,
  type SerialEvent,
  type SerialSubject,
} from './GenerateScheduleDialog'

/**
 * Entry point to the planner.
 *
 * The dialog is heavy and reads the clock, so it lives behind this button and
 * its body only mounts once opened.
 */
export function GenerateScheduleButton({
  subjects,
  events,
  weekStartISO,
  className = 'btn btn-outline-primary btn-sm',
  label = 'Generate',
}: {
  subjects: SerialSubject[]
  events: SerialEvent[]
  weekStartISO: string
  className?: string
  label?: string
}) {
  const [open, setOpen] = useState(false)
  const disabled = subjects.length === 0

  return (
    <>
      <button
        type="button"
        className={className}
        onClick={() => setOpen(true)}
        disabled={disabled}
        title={disabled ? 'Add a subject first' : 'Build a study plan from your priorities'}
      >
        <i className="bi bi-stars me-1" aria-hidden="true" />
        {label}
      </button>

      {/* Rendered unconditionally so the native dialog keeps its place in the
          DOM across opens; the expensive part is inside and mounts on demand. */}
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
