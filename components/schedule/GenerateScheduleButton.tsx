'use client'

import { useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import {
  GenerateScheduleDialog,
  type SerialEvent,
  type SerialExam,
  type SerialItem,
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
  items = [],
  exams = [],
  weekStartISO,
  className = 'btn btn-outline-primary btn-sm',
  label = 'Generate',
}: {
  subjects: SerialSubject[]
  events: SerialEvent[]
  items?: SerialItem[]
  exams?: SerialExam[]
  weekStartISO: string
  className?: string
  label?: string
}) {
  // `?plan=1` opens the planner on arrival, so "Plan this work" on the
  // subjects page lands straight in it.
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const [open, setOpen] = useState(() => searchParams.get('plan') === '1' && subjects.length > 0)

  function close() {
    setOpen(false)
    // Drop the flag so a reload or a save does not reopen the dialog.
    if (searchParams.get('plan')) {
      const next = new URLSearchParams(searchParams.toString())
      next.delete('plan')
      router.replace(next.size ? `${pathname}?${next}` : pathname, { scroll: false })
    }
  }
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
        onClose={close}
        subjects={subjects}
        events={events}
        items={items}
        exams={exams}
        weekStartISO={weekStartISO}
      />
    </>
  )
}
