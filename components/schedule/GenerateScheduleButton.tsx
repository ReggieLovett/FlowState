'use client'

import { useState } from 'react'
import dynamic from 'next/dynamic'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import type {
  SerialEvent,
  SerialExam,
  SerialItem,
  SerialSubject,
} from './GenerateScheduleDialog'

const loadPlanner = () => import('./GenerateScheduleDialog')
const GenerateScheduleDialog = dynamic(
  () => loadPlanner().then(module => module.GenerateScheduleDialog),
  { ssr: false, loading: () => <span role="status" className="small text-secondary ms-2">Loading planner…</span> },
)

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
  const [hasOpened, setHasOpened] = useState(open)

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
        onClick={() => { setHasOpened(true); setOpen(true) }}
        onPointerEnter={() => { if (!disabled) void loadPlanner().catch(() => {}) }}
        onFocus={() => { if (!disabled) void loadPlanner().catch(() => {}) }}
        aria-expanded={open}
        disabled={disabled}
        title={disabled ? 'Add a subject first' : 'Build a study plan from your priorities'}
      >
        <i className="bi bi-stars me-1" aria-hidden="true" />
        {label}
      </button>

      {/* Download the planner on intent and keep its dialog mounted after first use. */}
      {hasOpened && <GenerateScheduleDialog
        open={open}
        onClose={close}
        subjects={subjects}
        events={events}
        items={items}
        exams={exams}
        weekStartISO={weekStartISO}
      />}
    </>
  )
}
