'use client'

import { useActionState, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useFormStatus } from 'react-dom'
import {
  DEFAULT_PREFS,
  ITEM_LABELS,
  addDaysISO,
  examsFromItems,
  planCombined,
  toISODate,
  type ItemKind,
  type PlannedBlock,
  type SchedulingItem,
  type SchedulingPrefs,
  type SchedulingSubject,
} from '@/lib/scheduling'
import {
  PlanTimeline,
  findIssues,
  hhmm,
  minutesOfDay,
  placeBlock,
  type DraftBlock,
  type TimelineBusy,
  type TimelineDeadline,
} from './PlanTimeline'
import {
  clearGeneratedAction,
  confirmScheduleAction,
  type ConfirmState,
} from '@/lib/actions/scheduling'
import type { Category } from '@prisma/client'
import { FormAlert, useRateLimitActive } from '@/components/feedback/FormAlert'

/** Serialised subject as passed from server components. */
export interface SerialSubject {
  id: string
  name: string
  category: Category
  colorHex: string
  difficulty: number
  examDate: string | null
}

/** Serialised event as passed from server components. */
export interface SerialEvent {
  id: string
  subjectId: string | null
  startsAt: string
  endsAt: string
  isAllDay: boolean
  status: string
  isGenerated: boolean
  /** The sub-item the block works on, if any. */
  itemId?: string | null
  title?: string
}

/** An open subject item, serialised for the planner. */
export interface SerialItem {
  id: string
  subjectId: string
  title: string
  type: ItemKind
  /** YYYY-MM-DD */
  dueDate: string | null
  estimatedMinutes: number | null
  priority: number
  /** Non-cancelled minutes already linked to the item, anywhere in time. */
  bookedMinutes: number
}

/** An exam date, from an exam item open or done. */
export interface SerialExam {
  subjectId: string
  /** YYYY-MM-DD */
  date: string
}

type RangeKey = 'week' | 'fortnight' | 'month'

/**
 * Counted forward from the first day that can still be planned. These used to
 * end on the Sunday of the week on screen, which left "This week" empty from
 * Saturday onwards and nothing at all when viewing a past week.
 */
const RANGES: Record<RangeKey, { label: string; days: number }> = {
  week: { label: 'Next 7 days', days: 6 },
  fortnight: { label: 'Next 14 days', days: 13 },
  month: { label: 'Next 28 days', days: 27 },
}

/** A date-only value stored at UTC midnight, as the local calendar day. */
function examDay(iso: string): Date {
  const d = new Date(iso)
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}

/** Monday first, because the schedule page starts its weeks there. */
const WEEKDAYS = [
  { index: 1, label: 'M', full: 'Monday' },
  { index: 2, label: 'T', full: 'Tuesday' },
  { index: 3, label: 'W', full: 'Wednesday' },
  { index: 4, label: 'T', full: 'Thursday' },
  { index: 5, label: 'F', full: 'Friday' },
  { index: 6, label: 'S', full: 'Saturday' },
  { index: 0, label: 'S', full: 'Sunday' },
]

const PREFS_KEY = 'flowstate.scheduling.prefs.v2'

const DAY_LABEL = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
})

function formatDuration(minutes: number): string {
  if (minutes <= 0) return '0h'
  if (minutes < 60) return `${Math.round(minutes)}m`
  const hours = Math.floor(minutes / 60)
  const mins = Math.round(minutes % 60)
  return mins === 0 ? `${hours}h` : `${hours}h ${mins}m`
}

function labelForDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return DAY_LABEL.format(new Date(y, m - 1, d))
}

/**
 * Preferences survive the dialog closing.
 *
 * localStorage rather than a column on User: these are device habits ("I study
 * evenings on this laptop") more than account settings, and keeping them out of
 * the database means changing a default costs an edit here rather than a
 * migration. Every read is guarded because Safari's private mode throws on
 * access rather than returning null.
 */
type DialogPrefs = SchedulingPrefs & {
  /** After items are planned, fill the rest of the daily goal with study blocks. */
  fillStudyTime: boolean
}

const DEFAULT_DIALOG_PREFS: DialogPrefs = { ...DEFAULT_PREFS, fillStudyTime: true }

function loadPrefs(): DialogPrefs {
  try {
    const raw = window.localStorage.getItem(PREFS_KEY)
    if (!raw) return DEFAULT_DIALOG_PREFS
    const parsed = JSON.parse(raw) as Partial<DialogPrefs>
    const merged = { ...DEFAULT_DIALOG_PREFS, ...parsed }
    return {
      ...merged,
      studyDays: Array.isArray(merged.studyDays) && merged.studyDays.length > 0
        ? merged.studyDays
        : DEFAULT_PREFS.studyDays,
    }
  } catch {
    return DEFAULT_DIALOG_PREFS
  }
}

function savePrefs(prefs: DialogPrefs) {
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
  } catch {
    // Storage disabled. The dialog still works, it just forgets.
  }
}

function ConfirmButton({
  count,
  replacing,
  blocked = false,
}: {
  count: number
  replacing: number
  blocked?: boolean
}) {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      className="btn btn-primary"
      disabled={pending || count === 0 || blocked}
      title={blocked ? 'Move the blocks that are in the past first' : undefined}
    >
      {pending ? (
        <span className="spinner-border spinner-border-sm me-2" aria-hidden="true" />
      ) : (
        <i className="bi bi-stars me-1" aria-hidden="true" />
      )}
      {replacing > 0 ? `Replace with ${count}` : `Schedule ${count}`}{' '}
      {count === 1 ? 'block' : 'blocks'}
    </button>
  )
}

function ClearButton({ count, blocked = false }: { count: number; blocked?: boolean }) {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      className="btn btn-outline-secondary"
      disabled={pending || count === 0 || blocked}
      aria-label={`Clear ${count} generated ${count === 1 ? 'block' : 'blocks'} in this range`}
      title={count === 0 ? 'No generated blocks in this range' : 'Remove generated blocks in this range'}
    >
      {pending ? (
        <span className="spinner-border spinner-border-sm" aria-hidden="true" />
      ) : (
        <i className="bi bi-eraser" aria-hidden="true" />
      )}
      {/* Icon and count only on phones, so the footer holds one row. */}
      <span className="d-none d-sm-inline ms-1">Clear</span>
      {count > 0 && <span className="ms-1 tnum">{count}</span>}
    </button>
  )
}

function NumberField({
  id,
  label,
  suffix,
  value,
  min,
  max,
  step,
  onChange,
}: {
  id: string
  label: string
  suffix?: string
  value: number
  min: number
  max: number
  step: number
  onChange: (value: number) => void
}) {
  // What the user is typing, until it is a usable number or the field blurs.
  // Clamping each keystroke made values impossible to type: clearing "180" to
  // retype it snapped to the minimum before the second digit arrived.
  const [draft, setDraft] = useState<string | null>(null)

  return (
    <div>
      <label htmlFor={id} className="form-label small fw-medium mb-1">
        {label}
      </label>
      <div className="input-group input-group-sm">
        <input
          id={id}
          type="number"
          inputMode="numeric"
          className="form-control tnum"
          min={min}
          max={max}
          step={step}
          value={draft ?? String(value)}
          onChange={(event) => {
            const raw = event.target.value
            setDraft(raw)
            const next = Number(raw)
            if (raw !== '' && Number.isFinite(next) && next >= min && next <= max) onChange(next)
          }}
          onBlur={() => {
            if (draft === null) return
            const next = Number(draft)
            if (draft !== '' && Number.isFinite(next)) onChange(Math.min(max, Math.max(min, Math.round(next))))
            setDraft(null)
          }}
        />
        {suffix && <span className="input-group-text">{suffix}</span>}
      </div>
    </div>
  )
}

export function GenerateScheduleDialog({
  open,
  onClose,
  subjects,
  events,
  items = [],
  exams = [],
  weekStartISO,
}: {
  open: boolean
  onClose: () => void
  subjects: SerialSubject[]
  events: SerialEvent[]
  items?: SerialItem[]
  exams?: SerialExam[]
  weekStartISO: string
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      className="border-0 rounded-3 p-0 bg-body text-body plan-dialog"
      aria-label="Generate a study plan"
    >
      {/* Mounted only while open: the planner reads the clock, and rendering it
          during SSR would hand the browser a plan built at build time. */}
      {open && (
        <PlanBody
          onClose={onClose}
          subjects={subjects}
          events={events}
          items={items}
          exams={exams}
          weekStartISO={weekStartISO}
        />
      )}
    </dialog>
  )
}

function PlanBody({
  onClose,
  subjects,
  events,
  items,
  exams,
  weekStartISO,
}: {
  onClose: () => void
  subjects: SerialSubject[]
  events: SerialEvent[]
  items: SerialItem[]
  exams: SerialExam[]
  weekStartISO: string
}) {
  const [range, setRange] = useState<RangeKey>(() =>
    // Work due beyond a week needs a longer view to be planned properly.
    items.some((i) => i.dueDate && i.dueDate > addDaysISO(toISODate(new Date()), 6)) ? 'fortnight' : 'week',
  )
  const [prefs, setPrefs] = useState<DialogPrefs>(loadPrefs)
  const [excludedItems, setExcludedItems] = useState<Set<string>>(() => new Set())
  const [step, setStep] = useState<'settings' | 'review'>('settings')
  const [draft, setDraft] = useState<{
    base: string
    blocks: DraftBlock[]
    removed: DraftBlock[]
    edited: boolean
  } | null>(null)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [replace, setReplace] = useState(false)
  const [confirmState, confirmAction] = useActionState(
    confirmScheduleAction,
    {} as ConfirmState,
  )
  const [clearState, clearAction] = useActionState(
    clearGeneratedAction,
    {} as ConfirmState,
  )

  // Subjects whose exam has already gone start unticked: they still score, but
  // planning revision for a sat paper is almost never what was meant.
  const [excluded, setExcluded] = useState<Set<string>>(() => {
    const today = toISODate(new Date())
    return new Set(
      subjects
        .filter((s) => s.examDate && toISODate(examDay(s.examDate)) < today)
        .map((s) => s.id),
    )
  })

  useEffect(() => savePrefs(prefs), [prefs])

  useEffect(() => {
    if (confirmState.ok || clearState.ok) onClose()
  }, [confirmState.ok, clearState.ok, onClose])

  const update = useCallback(
    (patch: Partial<DialogPrefs>) => setPrefs((current) => ({ ...current, ...patch })),
    [],
  )

  const toggleDay = useCallback((index: number) => {
    setPrefs((current) => {
      const next = current.studyDays.includes(index)
        ? current.studyDays.filter((d) => d !== index)
        : [...current.studyDays, index]
      return { ...current, studyDays: next.length === 0 ? current.studyDays : next.sort() }
    })
  }, [])

  const now = useMemo(() => new Date(), [])
  const todayIso = toISODate(now)
  const weekStartIso = toISODate(new Date(weekStartISO))
  const startDate = weekStartIso > todayIso ? weekStartIso : todayIso
  const endDate = addDaysISO(startDate, RANGES[range].days)

  // Half-open [from, to): `to` is midnight after the last day, so a block that
  // ends at 24:00 still sits inside the range the server checks against.
  const rangeBounds = useMemo(() => {
    const [sy, sm, sd] = startDate.split('-').map(Number)
    const [ey, em, ed] = endDate.split('-').map(Number)
    return { from: new Date(sy, sm - 1, sd), to: new Date(ey, em - 1, ed + 1) }
  }, [startDate, endDate])

  const parsedEvents = useMemo(
    () =>
      events.map((event) => ({
        ...event,
        startsAt: new Date(event.startsAt),
        endsAt: new Date(event.endsAt),
      })),
    [events],
  )

  /**
   * Generated blocks the confirm would overwrite, counted for the button.
   * Completed ones are excluded: they hold earned XP and the server keeps them.
   */
  const replaceable = useMemo(
    () =>
      parsedEvents.filter(
        (event) =>
          event.isGenerated &&
          event.status !== 'COMPLETED' &&
          event.startsAt < rangeBounds.to &&
          event.endsAt > rangeBounds.from,
      ),
    [parsedEvents, rangeBounds],
  )

  const included = useMemo(
    () => subjects.filter((subject) => !excluded.has(subject.id)),
    [subjects, excluded],
  )

  const schedulingSubjects: SchedulingSubject[] = useMemo(
    () =>
      included.map((subject) => ({
        ...subject,
        examDate: subject.examDate ? examDay(subject.examDate) : null,
      })),
    [included],
  )

  const allSchedulingSubjects: SchedulingSubject[] = useMemo(
    () =>
      subjects.map((subject) => ({
        ...subject,
        examDate: subject.examDate ? examDay(subject.examDate) : null,
      })),
    [subjects],
  )

  // With replace on, last run's blocks are about to disappear, so the planner
  // must not treat their slots as taken or count them against the daily goal.
  const visibleEvents = useMemo(() => {
    if (!replace) return parsedEvents
    const doomed = new Set(replaceable.map((e) => e.id))
    return parsedEvents.filter((event) => !doomed.has(event.id))
  }, [parsedEvents, replace, replaceable])

  const schedulingItems: SchedulingItem[] = useMemo(() => {
    const doomed = new Set(replace ? replaceable.map((e) => e.id) : [])
    return items
      .filter((item) => !excludedItems.has(item.id))
      .map((item) => {
        // Booked time that the replace is about to delete is not booked.
        const leaving = parsedEvents
          .filter((e) => e.itemId === item.id && doomed.has(e.id))
          .reduce((sum, e) => sum + (e.endsAt.getTime() - e.startsAt.getTime()) / 60_000, 0)
        const [y, m, d] = (item.dueDate ?? '').split('-').map(Number)
        return {
          ...item,
          dueDate: item.dueDate ? new Date(y, m - 1, d) : null,
          bookedMinutes: Math.max(0, item.bookedMinutes - leaving),
        }
      })
  }, [items, excludedItems, parsedEvents, replace, replaceable])

  // Every known exam per subject, ticked off or not, plus the exam items being
  // planned. Unticking an exam item leaves it out of revision, not out of
  // existence: study for its subject still ends the day before it.
  const examsBySubject = useMemo(() => {
    const map = examsFromItems(schedulingItems)
    for (const exam of exams) map.set(exam.subjectId, [...(map.get(exam.subjectId) ?? []), exam.date])
    return map
  }, [exams, schedulingItems])

  const plan = useMemo(
    () =>
      planCombined(schedulingItems, allSchedulingSubjects, visibleEvents, startDate, endDate, prefs, {
        notBefore: todayIso,
        notBeforeMinutes: now.getHours() * 60 + now.getMinutes(),
        fillStudyTime: prefs.fillStudyTime,
        studySubjects: schedulingSubjects,
        examsBySubject,
      }),
    [
      schedulingItems,
      allSchedulingSubjects,
      visibleEvents,
      startDate,
      endDate,
      prefs,
      todayIso,
      now,
      schedulingSubjects,
      examsBySubject,
    ],
  )

  // ------------------------------------------------------------ draft -------
  // Timeline edits live in a draft tied to the plan they were made on. If the
  // settings change, the plan changes, the draft no longer matches, and the
  // fresh plan wins; the review step says so rather than silently mixing the two.
  const planSignature = useMemo(
    () =>
      plan.blocks
        .map((b) => `${b.itemId ?? b.subjectId}@${b.startsAt.getTime()}-${b.endsAt.getTime()}`)
        .join('|'),
    [plan.blocks],
  )
  const draftCurrent = draft && draft.base === planSignature ? draft : null
  const rebuilt = Boolean(draft?.edited && !draftCurrent)
  const activeBlocks: PlannedBlock[] = draftCurrent ? draftCurrent.blocks : plan.blocks

  const rangeDays = useMemo(() => {
    const out: string[] = []
    for (let d = startDate; d <= endDate; d = addDaysISO(d, 1)) out.push(d)
    return out
  }, [startDate, endDate])

  const busy: TimelineBusy[] = useMemo(
    () =>
      visibleEvents
        .filter((e) => e.status !== 'CANCELLED' && e.startsAt < rangeBounds.to && e.endsAt > rangeBounds.from)
        .map((e) => {
          const start = e.isAllDay ? 0 : minutesOfDay(e.startsAt)
          const rawEnd = e.isAllDay ? 24 * 60 : minutesOfDay(e.endsAt)
          return {
            key: e.id,
            date: toISODate(e.startsAt),
            start,
            end: rawEnd <= start ? 24 * 60 : rawEnd,
            title: e.title ?? 'Busy',
          }
        }),
    [visibleEvents, rangeBounds],
  )

  const subjectColor = useMemo(() => new Map(subjects.map((s) => [s.id, s.colorHex])), [subjects])
  const deadlines: TimelineDeadline[] = useMemo(
    () =>
      schedulingItems
        .filter((i) => i.dueDate)
        .map((i) => ({
          itemId: i.id,
          date: toISODate(i.dueDate!),
          title: i.title,
          type: i.type,
          color: subjectColor.get(i.subjectId) ?? '#868E96',
        }))
        // A subject's own exam date is planned for too (as revision), so it
        // gets a marker like an exam item, unless one already sits on that day.
        .concat(
          schedulingSubjects
            .filter((s) => s.examDate)
            .map((s) => ({
              itemId: `exam:${s.id}`,
              date: toISODate(s.examDate!),
              title: `${s.name} exam`,
              type: 'EXAM' as const,
              color: s.colorHex,
            }))
            .filter(
              (exam) =>
                !schedulingItems.some(
                  (i) => i.type === 'EXAM' && i.subjectId === exam.itemId.slice(5) && i.dueDate && toISODate(i.dueDate) === exam.date,
                ),
            ),
        )
        .filter((d) => d.date >= startDate && d.date <= endDate),
    [schedulingItems, schedulingSubjects, subjectColor, startDate, endDate],
  )
  const dueByItem = useMemo(
    () =>
      Object.fromEntries(
        schedulingItems.filter((i) => i.dueDate).map((i) => [i.id, { date: toISODate(i.dueDate!), type: i.type }]),
      ),
    [schedulingItems],
  )
  const studyWindow = { start: prefs.dayStartHour * 60, end: prefs.dayEndHour * 60 }
  const issues = findIssues(draftCurrent?.blocks ?? [], busy, dueByItem, studyWindow, now)
  const issueCounts = [...issues.values()].reduce(
    (acc, i) => ({
      clash: acc.clash + (i.clash || i.overlap ? 1 : 0),
      late: acc.late + (i.late ? 1 : 0),
      past: acc.past + (i.past ? 1 : 0),
      outside: acc.outside + (i.outside ? 1 : 0),
    }),
    { clash: 0, late: 0, past: 0, outside: 0 },
  )

  function openReview() {
    if (!draftCurrent) {
      setDraft({
        base: planSignature,
        blocks: plan.blocks.map((b, i) => ({ ...b, key: `${i}-${b.startsAt.getTime()}` })),
        removed: [],
        edited: false,
      })
      setSelectedKey(null)
    }
    setStep('review')
  }

  function editDraft(change: (d: NonNullable<typeof draft>) => NonNullable<typeof draft>) {
    setDraft((current) => (current ? { ...change(current), edited: true } : current))
  }

  const moveBlock = (key: string, date: string, start: number, end: number) =>
    editDraft((d) => ({ ...d, blocks: d.blocks.map((b) => (b.key === key ? placeBlock(b, date, start, end) : b)) }))

  const removeBlock = (key: string) => {
    editDraft((d) => {
      const gone = d.blocks.find((b) => b.key === key)
      return gone ? { ...d, blocks: d.blocks.filter((b) => b.key !== key), removed: [...d.removed, gone] } : d
    })
    setSelectedKey(null)
  }

  const restoreBlock = (key: string) =>
    editDraft((d) => {
      const back = d.removed.find((b) => b.key === key)
      return back ? { ...d, removed: d.removed.filter((b) => b.key !== key), blocks: [...d.blocks, back] } : d
    })

  const resetDraft = () => {
    setDraft({
      base: planSignature,
      blocks: plan.blocks.map((b, i) => ({ ...b, key: `${i}-${b.startsAt.getTime()}` })),
      removed: [],
      edited: false,
    })
    setSelectedKey(null)
  }

  const selected = draftCurrent?.blocks.find((b) => b.key === selectedKey) ?? null

  // Time split and day list read from whatever will actually be saved.
  const splitBySubject = useMemo(() => {
    const total = activeBlocks.reduce((sum, b) => sum + b.duration, 0)
    const bySubject = new Map<string, number>()
    for (const b of activeBlocks) bySubject.set(b.subjectId, (bySubject.get(b.subjectId) ?? 0) + b.duration)
    return { total, bySubject }
  }, [activeBlocks])

  const byDay = useMemo(
    () =>
      rangeDays
        .map((date) => ({ date, blocks: activeBlocks.filter((b) => b.date === date) }))
        .filter((d) => d.blocks.length > 0 || prefs.studyDays.includes(new Date(`${d.date}T12:00`).getDay())),
    [rangeDays, activeBlocks, prefs.studyDays],
  )
  const activeDays = byDay.filter((d) => d.blocks.length > 0).length

  // Both forms share one limit, so whichever was refused last owns the message.
  const failed = confirmState.error ? confirmState : clearState
  const planLimited = useRateLimitActive(failed.rateLimit)
  const maxPriority = Math.max(1, ...plan.study.scored.map((s) => s.priorityScore))

  // The plan travels in a hidden field that always holds the current preview.
  //
  // This used to be filled in by an onSubmit handler that called
  // preventDefault() and then requestSubmit(). React skips a form action whose
  // submit event was cancelled, and the browser ignores requestSubmit() while
  // the first submit is still dispatching, so the button never saved anything.
  // A controlled value needs no handler: React reads it with the rest of the
  // form when the action runs.
  const payload = useMemo(
    () =>
      JSON.stringify({
        replace,
        rangeStart: rangeBounds.from.toISOString(),
        rangeEnd: rangeBounds.to.toISOString(),
        blocks: activeBlocks.map((block) => ({
          subjectId: block.subjectId,
          itemId: block.itemId,
          title: block.title,
          // Study time, not the subject's own type: a revision block for a
          // lecture course is not a lecture.
          category: 'DEEP_WORK_SHIFT',
          startsAt: block.startsAt.toISOString(),
          endsAt: block.endsAt.toISOString(),
          // A block dragged on the timeline is no longer where the planner put
          // it, so its reason no longer applies.
          planReason: 'moved' in block && block.moved ? null : block.reason,
        })),
      }),
    [activeBlocks, replace, rangeBounds],
  )

  return (
    <>
      <div className="d-flex align-items-center justify-content-between border-bottom px-4 py-3">
        <div className="min-width-0">
          <h2 className="h6 fw-semibold mb-0 d-flex align-items-center gap-2">
            <i className="bi bi-stars text-primary" aria-hidden="true" />
            {step === 'review' ? 'Review and adjust your plan' : 'Generate a study plan'}
          </h2>
          <p className="text-secondary mb-0 tnum" style={{ fontSize: '0.75rem' }}>
            {labelForDate(startDate)} to {labelForDate(endDate)} ·{' '}
            <span className="plan-steps">
              <span className={step === 'settings' ? 'is-current' : undefined}>1 Settings</span>
              <i className="bi bi-chevron-right" aria-hidden="true" />
              <span className={step === 'review' ? 'is-current' : undefined}>2 Review</span>
            </span>
          </p>
        </div>
        <button type="button" className="btn-close" aria-label="Close" onClick={onClose} />
      </div>

      <div className="plan-dialog-body">
        <FormAlert error={failed.error} rateLimit={failed.rateLimit} className="m-4 mb-0" />

        {subjects.length === 0 ? (
          <p className="text-secondary small m-4">
            Add subjects with difficulty ratings and exam dates first. The planner
            uses those to decide who gets your time.
          </p>
        ) : step === 'review' && draftCurrent ? (
          <div className="plan-review p-3 p-lg-4 d-flex flex-column gap-3">
            {rebuilt && (
              <div className="alert alert-info py-2 px-3 small mb-0" role="status">
                The settings changed, so the plan was rebuilt and earlier timeline edits were replaced.
              </div>
            )}

            <div className="d-flex flex-wrap align-items-center justify-content-between gap-2">
              <div className="small text-secondary">
                <i className="bi bi-arrows-move me-1" aria-hidden="true" />
                Drag a block to another time or day, drag its right edge to resize, or select it and
                use the arrow keys.
              </div>
              <div className="d-flex flex-wrap gap-2 small" role="status">
                <span className="chip tnum">
                  {activeBlocks.length} blocks · {formatDuration(splitBySubject.total)}
                </span>
                {issueCounts.clash > 0 && (
                  <span className="plan-issue is-error">
                    <i className="bi bi-exclamation-octagon me-1" aria-hidden="true" />
                    {issueCounts.clash} {issueCounts.clash === 1 ? 'clash' : 'clashes'}
                  </span>
                )}
                {issueCounts.past > 0 && (
                  <span className="plan-issue is-error">
                    <i className="bi bi-clock-history me-1" aria-hidden="true" />
                    {issueCounts.past} in the past
                  </span>
                )}
                {issueCounts.late > 0 && (
                  <span className="plan-issue is-warn">
                    <i className="bi bi-flag me-1" aria-hidden="true" />
                    {issueCounts.late} after a deadline
                  </span>
                )}
                {issueCounts.outside > 0 && (
                  <span className="plan-issue is-warn">
                    <i className="bi bi-moon me-1" aria-hidden="true" />
                    {issueCounts.outside} outside study hours
                  </span>
                )}
              </div>
            </div>

            <div className="plan-timeline-scroll">
              <PlanTimeline
                days={rangeDays}
                blocks={draftCurrent.blocks}
                busy={busy}
                deadlines={deadlines}
                issues={issues}
                studyDays={prefs.studyDays}
                studyWindow={studyWindow}
                now={now}
                selectedKey={selectedKey}
                onSelect={setSelectedKey}
                onMove={moveBlock}
                onRemove={removeBlock}
              />
            </div>

            <div className="row g-3">
              <div className="col-12 col-lg-8">
                {selected ? (
                  <div className="plan-selected card card-body py-3">
                    <div className="d-flex align-items-start justify-content-between gap-2 mb-2">
                      <div className="min-width-0">
                        <div className="small fw-semibold text-truncate d-flex align-items-center gap-2">
                          <span className="category-dot" style={{ ['--dot-color' as string]: selected.subjectColor }} aria-hidden="true" />
                          {selected.title}
                        </div>
                        <div className="text-secondary" style={{ fontSize: '0.75rem' }}>
                          {selected.subjectName}
                          {selected.itemType ? ` · ${ITEM_LABELS[selected.itemType].label}` : ' · Study time'}
                          {selected.itemId && dueByItem[selected.itemId]
                            ? ` · due ${labelForDate(dueByItem[selected.itemId].date)}`
                            : ''}
                        </div>
                      </div>
                      <button
                        type="button"
                        className="btn btn-sm btn-outline-danger flex-shrink-0"
                        onClick={() => removeBlock(selected.key)}
                      >
                        <i className="bi bi-x-lg me-1" aria-hidden="true" />
                        Remove
                      </button>
                    </div>
                    <div className="row g-2">
                      <div className="col-12 col-sm-5">
                        <label htmlFor="sel-day" className="form-label small fw-medium mb-1">Day</label>
                        <select
                          id="sel-day"
                          className="form-select form-select-sm"
                          value={selected.date}
                          onChange={(e) => {
                            const start = minutesOfDay(selected.startsAt)
                            moveBlock(selected.key, e.target.value, start, start + selected.duration)
                          }}
                        >
                          {rangeDays.map((d) => (
                            <option key={d} value={d}>
                              {labelForDate(d)}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="col-6 col-sm-4">
                        <label htmlFor="sel-start" className="form-label small fw-medium mb-1">Start</label>
                        <input
                          id="sel-start"
                          type="time"
                          step={900}
                          className="form-control form-control-sm tnum"
                          value={hhmm(minutesOfDay(selected.startsAt))}
                          onChange={(e) => {
                            const [h, m] = e.target.value.split(':').map(Number)
                            if (!Number.isFinite(h) || !Number.isFinite(m)) return
                            const start = Math.min(24 * 60 - selected.duration, h * 60 + m)
                            moveBlock(selected.key, selected.date, start, start + selected.duration)
                          }}
                        />
                      </div>
                      <div className="col-6 col-sm-3">
                        <label htmlFor="sel-length" className="form-label small fw-medium mb-1">Length</label>
                        <select
                          id="sel-length"
                          className="form-select form-select-sm tnum"
                          value={selected.duration}
                          onChange={(e) => {
                            const start = minutesOfDay(selected.startsAt)
                            const length = Number(e.target.value)
                            moveBlock(selected.key, selected.date, start, Math.min(24 * 60, start + length))
                          }}
                        >
                          {Array.from(new Set([...Array.from({ length: 16 }, (_, i) => (i + 1) * 15), selected.duration]))
                            .sort((a, b) => a - b)
                            .map((minutes) => (
                              <option key={minutes} value={minutes}>
                                {formatDuration(minutes)}
                              </option>
                            ))}
                        </select>
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="text-secondary small mb-0 plan-selected-empty">
                    Select a block to change its day, start time or length precisely, or to remove it.
                  </p>
                )}
              </div>

              <div className="col-12 col-lg-4">
                {draftCurrent.removed.length > 0 && (
                  <div className="plan-removed">
                    <div className="small fw-semibold mb-1">Removed from the plan</div>
                    <ul className="list-unstyled mb-0 d-flex flex-column gap-1">
                      {draftCurrent.removed.map((b) => (
                        <li key={b.key} className="d-flex align-items-center justify-content-between gap-2 small">
                          <span className="text-truncate">
                            <span className="category-dot me-1" style={{ ['--dot-color' as string]: b.subjectColor }} aria-hidden="true" />
                            {b.title}
                          </span>
                          <button type="button" className="btn btn-sm btn-link p-0 flex-shrink-0" onClick={() => restoreBlock(b.key)}>
                            Restore
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="row g-0">
            {/* ------------------------------------------------ settings --- */}
            <div className="col-12 col-lg-5 border-lg-end plan-settings">
              <div className="p-4 d-flex flex-column gap-3">
                <div>
                  <label htmlFor="plan-range" className="form-label small fw-medium mb-1">
                    Plan ahead
                  </label>
                  <select
                    id="plan-range"
                    className="form-select form-select-sm"
                    value={range}
                    onChange={(event) => setRange(event.target.value as RangeKey)}
                  >
                    {Object.entries(RANGES).map(([key, { label }]) => (
                      <option key={key} value={key}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <span className="form-label small fw-medium mb-1 d-block" id="plan-days-label">
                    Study days
                  </span>
                  <div className="btn-group w-100" role="group" aria-labelledby="plan-days-label">
                    {WEEKDAYS.map((day) => {
                      const active = prefs.studyDays.includes(day.index)
                      return (
                        <button
                          key={day.full}
                          type="button"
                          className={`btn btn-sm day-toggle ${
                            active ? 'btn-primary' : 'btn-outline-secondary'
                          }`}
                          aria-pressed={active}
                          aria-label={day.full}
                          title={day.full}
                          onClick={() => toggleDay(day.index)}
                        >
                          {day.label}
                        </button>
                      )
                    })}
                  </div>
                </div>

                <div className="row g-2">
                  <div className="col-6">
                    <NumberField
                      id="plan-goal"
                      label="Daily goal"
                      suffix="min"
                      value={prefs.dailyGoalMinutes}
                      min={30}
                      max={720}
                      step={15}
                      onChange={(value) => update({ dailyGoalMinutes: value })}
                    />
                  </div>
                  <div className="col-6">
                    <NumberField
                      id="plan-block"
                      label="Block length"
                      suffix="min"
                      value={prefs.blockDuration}
                      min={15}
                      max={180}
                      step={5}
                      onChange={(value) => update({ blockDuration: value })}
                    />
                  </div>
                  <div className="col-6">
                    <NumberField
                      id="plan-break"
                      label="Short break"
                      suffix="min"
                      value={prefs.breakDuration}
                      min={0}
                      max={60}
                      step={5}
                      onChange={(value) => update({ breakDuration: value })}
                    />
                  </div>
                  <div className="col-6">
                    <NumberField
                      id="plan-longbreak"
                      label="Long break after"
                      suffix="blocks"
                      value={prefs.breakAfterBlocks}
                      min={1}
                      max={8}
                      step={1}
                      onChange={(value) => update({ breakAfterBlocks: value })}
                    />
                  </div>
                  <div className="col-6">
                    <NumberField
                      id="plan-start"
                      label="Not before"
                      suffix=":00"
                      value={prefs.dayStartHour}
                      min={0}
                      max={23}
                      step={1}
                      onChange={(value) =>
                        update({
                          dayStartHour: value,
                          dayEndHour: Math.max(value + 1, prefs.dayEndHour),
                        })
                      }
                    />
                  </div>
                  <div className="col-6">
                    <NumberField
                      id="plan-end"
                      label="Not after"
                      suffix=":00"
                      value={prefs.dayEndHour}
                      min={1}
                      max={24}
                      step={1}
                      onChange={(value) =>
                        update({
                          dayEndHour: value,
                          dayStartHour: Math.min(value - 1, prefs.dayStartHour),
                        })
                      }
                    />
                  </div>
                  <div className="col-6">
                    <NumberField
                      id="plan-maxday"
                      label="Max per subject"
                      suffix="/day"
                      value={prefs.maxBlocksPerSubjectPerDay}
                      min={1}
                      max={8}
                      step={1}
                      onChange={(value) => update({ maxBlocksPerSubjectPerDay: value })}
                    />
                  </div>
                </div>

                <div className="form-check form-switch mb-0">
                  <input
                    className="form-check-input"
                    type="checkbox"
                    role="switch"
                    id="plan-interleave"
                    checked={prefs.interleave}
                    onChange={(event) => update({ interleave: event.target.checked })}
                  />
                  <label className="form-check-label small" htmlFor="plan-interleave">
                    Rotate subjects
                    <span className="d-block text-secondary" style={{ fontSize: '0.75rem' }}>
                      {prefs.interleave
                        ? 'Alternate subjects between blocks.'
                        : 'Stack each subject back to back, up to its daily limit.'}
                    </span>
                  </label>
                </div>

                <div className="form-check form-switch mb-0">
                  <input
                    className="form-check-input"
                    type="checkbox"
                    role="switch"
                    id="plan-fill"
                    checked={prefs.fillStudyTime}
                    onChange={(event) => update({ fillStudyTime: event.target.checked })}
                  />
                  <label className="form-check-label small" htmlFor="plan-fill">
                    Fill spare time with study blocks
                    <span className="d-block text-secondary" style={{ fontSize: '0.75rem' }}>
                      {prefs.fillStudyTime
                        ? 'Tasks and exams go first, then general study time up to your daily goal.'
                        : 'Only tasks, assignments, projects and exams are scheduled.'}
                    </span>
                  </label>
                </div>

                <div className="form-check form-switch mb-0">
                  <input
                    className="form-check-input"
                    type="checkbox"
                    role="switch"
                    id="plan-replace"
                    checked={replace}
                    disabled={replaceable.length === 0}
                    onChange={(event) => setReplace(event.target.checked)}
                  />
                  <label className="form-check-label small" htmlFor="plan-replace">
                    Replace the last plan
                    <span className="d-block text-secondary" style={{ fontSize: '0.75rem' }}>
                      {replaceable.length === 0
                        ? 'No generated blocks in this range yet.'
                        : `Removes ${replaceable.length} generated ${
                            replaceable.length === 1 ? 'block' : 'blocks'
                          }. Your own events and completed blocks stay.`}
                    </span>
                  </label>
                </div>
              </div>
            </div>

            {/* ------------------------------------------------- preview --- */}
            <div className="col-12 col-lg-7">
              <div className="p-4 d-flex flex-column gap-4">
                <section>
                  <div className="d-flex align-items-baseline justify-content-between gap-2 mb-2">
                    <h3 className="h6 fw-semibold mb-0">Time split</h3>
                    <span className="text-secondary tnum" style={{ fontSize: '0.75rem' }}>
                      {formatDuration(splitBySubject.total)} · {activeBlocks.length} blocks ·{' '}
                      {activeDays} {activeDays === 1 ? 'day' : 'days'}
                    </span>
                  </div>

                  {activeBlocks.length > 0 ? (
                    <div className="plan-bar" aria-hidden="true">
                      {subjects
                        .filter((subject) => splitBySubject.bySubject.get(subject.id))
                        .map((subject) => (
                          <span
                            key={subject.id}
                            style={{
                              width: `${((splitBySubject.bySubject.get(subject.id) ?? 0) / splitBySubject.total) * 100}%`,
                              background: subject.colorHex,
                            }}
                          />
                        ))}
                    </div>
                  ) : (
                    <p className="text-secondary small mb-0">
                      Nothing to plan yet. Tick a subject or an item below.
                    </p>
                  )}
                </section>

                {items.length > 0 && (
                  <section>
                    <div className="d-flex align-items-baseline justify-content-between gap-2 mb-2">
                      <h3 className="h6 fw-semibold mb-0">Tasks and deadlines</h3>
                      <span className="text-secondary" style={{ fontSize: '0.75rem' }}>
                        Earliest deadline first
                      </span>
                    </div>
                    <ul className="list-unstyled mb-0 d-flex flex-column">
                      {items.map((item) => {
                        const isIncluded = !excludedItems.has(item.id)
                        const entry = plan.items.entries.find((e) => e.item.id === item.id)
                        const subject = subjects.find((s) => s.id === item.subjectId)
                        const inputId = `plan-item-${item.id}`
                        const status = !isIncluded
                          ? 'skipped'
                          : !entry
                            ? 'subject unavailable'
                            : entry.neededMinutes === 0
                              ? 'already booked'
                              : `${entry.sessions} ${entry.sessions === 1 ? 'session' : 'sessions'} · ${formatDuration(entry.plannedMinutes)}`

                        return (
                          <li key={item.id} className="plan-subject">
                            <div className="d-flex align-items-start gap-2">
                              <input
                                className="form-check-input mt-1 flex-shrink-0"
                                type="checkbox"
                                id={inputId}
                                checked={isIncluded}
                                onChange={() =>
                                  setExcludedItems((current) => {
                                    const next = new Set(current)
                                    if (next.has(item.id)) next.delete(item.id)
                                    else next.add(item.id)
                                    return next
                                  })
                                }
                              />
                              <label htmlFor={inputId} className={`flex-grow-1 min-width-0 ${isIncluded ? '' : 'opacity-50'}`}>
                                <span className="d-flex align-items-baseline gap-2">
                                  <i className={`bi ${ITEM_LABELS[item.type].icon} text-secondary`} aria-hidden="true" />
                                  <span className="small fw-medium text-truncate flex-grow-1">{item.title}</span>
                                  <span className="text-secondary tnum flex-shrink-0" style={{ fontSize: '0.75rem' }}>
                                    {status}
                                  </span>
                                </span>
                                <span className="d-flex align-items-center flex-wrap gap-2 mt-1">
                                  {subject && (
                                    <span className="d-inline-flex align-items-center gap-1 text-secondary" style={{ fontSize: '0.75rem' }}>
                                      <span className="category-dot" style={{ ['--dot-color' as string]: subject.colorHex }} aria-hidden="true" />
                                      {subject.name}
                                    </span>
                                  )}
                                  <span className="chip">{ITEM_LABELS[item.type].label}</span>
                                  {item.dueDate && (
                                    <span className={`chip${entry?.overdue ? ' is-danger' : ''}`}>
                                      {entry?.overdue ? 'Overdue · ' : item.type === 'EXAM' ? 'Exam ' : 'Due '}
                                      {labelForDate(item.dueDate)}
                                    </span>
                                  )}
                                  {entry && (
                                    <span className="chip tnum" title={entry.estimated ? 'Suggested from type and difficulty' : 'Your estimate'}>
                                      {formatDuration(entry.effortMinutes)} {entry.estimated ? 'suggested' : 'effort'}
                                    </span>
                                  )}
                                  {entry && entry.unplacedMinutes > 0 && (
                                    <span className="chip is-danger">{formatDuration(entry.unplacedMinutes)} won&apos;t fit</span>
                                  )}
                                </span>
                              </label>
                            </div>
                          </li>
                        )
                      })}
                    </ul>
                  </section>
                )}

                <section className={prefs.fillStudyTime ? undefined : 'opacity-50'}>
                  <div className="d-flex align-items-baseline justify-content-between gap-2 mb-2">
                    <h3 className="h6 fw-semibold mb-0">Study time</h3>
                    <span className="text-secondary" style={{ fontSize: '0.75rem' }}>
                      {prefs.fillStudyTime ? 'Fills the rest of each daily goal' : 'Off'}
                    </span>
                  </div>

                  <ul className="list-unstyled mb-0 d-flex flex-column gap-2">
                    {included.length === 0 && (
                      <li className="text-secondary small">
                        Every subject is unticked for study time.
                      </li>
                    )}

                    {subjects.map((subject) => {
                      const isIncluded = !excluded.has(subject.id)
                      const scored = plan.study.scored.find((s) => s.id === subject.id)
                      const entry = plan.study.bySubject.find((s) => s.subject.id === subject.id)
                      const inputId = `plan-subject-${subject.id}`

                      return (
                        <li key={subject.id} className="plan-subject">
                          <div className="d-flex align-items-start gap-2">
                            <input
                              className="form-check-input mt-1 flex-shrink-0"
                              type="checkbox"
                              id={inputId}
                              checked={isIncluded}
                              disabled={!prefs.fillStudyTime}
                              onChange={() =>
                                setExcluded((current) => {
                                  const next = new Set(current)
                                  if (next.has(subject.id)) next.delete(subject.id)
                                  else next.add(subject.id)
                                  return next
                                })
                              }
                            />
                            <label htmlFor={inputId} className={`flex-grow-1 min-width-0 ${isIncluded ? '' : 'opacity-50'}`}>
                              <span className="d-flex align-items-baseline gap-2">
                                <span
                                  className="category-dot"
                                  style={{ ['--dot-color' as string]: subject.colorHex }}
                                  aria-hidden="true"
                                />
                                <span className="small fw-medium text-truncate flex-grow-1">{subject.name}</span>
                                <span className="text-secondary tnum flex-shrink-0" style={{ fontSize: '0.75rem' }}>
                                  {entry && entry.minutes > 0
                                    ? `${formatDuration(entry.minutes)} · ${entry.blocks} ${entry.blocks === 1 ? 'block' : 'blocks'}`
                                    : isIncluded && prefs.fillStudyTime
                                      ? 'no spare time'
                                      : 'skipped'}
                                </span>
                              </span>

                              <span className="d-flex align-items-center flex-wrap gap-2 mt-1">
                                <span
                                  className="plan-priority"
                                  role="img"
                                  aria-label={`Priority ${Math.round(scored?.priorityScore ?? 0)} out of 100`}
                                >
                                  <span
                                    style={{
                                      width: `${((scored?.priorityScore ?? 0) / maxPriority) * 100}%`,
                                      background: subject.colorHex,
                                    }}
                                  />
                                </span>
                                {(scored?.reasons ?? []).slice(0, 2).map((reason) => (
                                  <span key={reason} className="chip">
                                    {reason}
                                  </span>
                                ))}
                              </span>
                            </label>
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                </section>

                <section>
                  <div className="d-flex align-items-baseline justify-content-between gap-2 mb-2">
                    <h3 className="h6 fw-semibold mb-0">Day by day</h3>
                    {activeBlocks.length > 0 && (
                      <button type="button" className="btn btn-link btn-sm p-0" onClick={openReview}>
                        Adjust on the timeline
                      </button>
                    )}
                  </div>
                  {draftCurrent?.edited && (
                    <p className="small text-secondary mb-2">
                      <i className="bi bi-pencil me-1" aria-hidden="true" />
                      Includes your timeline edits.
                    </p>
                  )}
                  {rebuilt && step === 'settings' && (
                    <p className="small text-secondary mb-2">
                      <i className="bi bi-arrow-repeat me-1" aria-hidden="true" />
                      Settings changed, so earlier timeline edits no longer apply.
                    </p>
                  )}

                  {byDay.length === 0 ? (
                    <p className="text-secondary small mb-0 py-3 text-center border rounded">
                      No study days in this range. Add days of the week on the left.
                    </p>
                  ) : (
                    <ul className="list-unstyled mb-0 d-flex flex-column gap-2 plan-days">
                      {byDay.map((day) => (
                        <li key={day.date} className="d-flex align-items-start gap-3">
                          <span className="text-secondary small tnum flex-shrink-0 pt-1" style={{ width: '5.5rem' }}>
                            {labelForDate(day.date)}
                          </span>
                          {day.blocks.length === 0 ? (
                            <span className="text-secondary" style={{ fontSize: '0.75rem', paddingTop: '0.3rem' }}>
                              free
                            </span>
                          ) : (
                            <span className="d-flex flex-wrap gap-1">
                              {day.blocks.map((block) => (
                                <span
                                  key={`${block.date}-${block.startTime}-${block.itemId ?? block.subjectId}`}
                                  className={`plan-block${block.overGoal ? ' is-over' : ''}`}
                                  style={{ ['--block-color' as string]: block.subjectColor }}
                                  title={`${block.startTime} to ${block.endTime} · ${block.title}${block.overGoal ? ' · past your daily goal to meet a deadline' : ''}`}
                                >
                                  <span className="tnum">{block.startTime}</span>
                                  {block.itemType && <i className={`bi ${ITEM_LABELS[block.itemType].icon}`} aria-hidden="true" />}
                                  <span className="text-truncate">{block.itemTitle ?? block.subjectName}</span>
                                </span>
                              ))}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                {plan.warnings.length > 0 && (
                  <div className="alert alert-warning py-2 px-3 small mb-0">
                    <div className="fw-medium mb-1">
                      <i className="bi bi-exclamation-triangle me-1" aria-hidden="true" />
                      Worth a look
                    </div>
                    <ul className="mb-0 ps-3">
                      {plan.warnings.map((warning) => (
                        <li key={warning}>{warning}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="d-flex flex-wrap justify-content-between gap-2 border-top px-4 py-3 bg-body-tertiary">
        {step === 'review' ? (
          <div className="d-flex gap-2">
            <button type="button" className="btn btn-outline-secondary" onClick={() => setStep('settings')}>
              <i className="bi bi-arrow-left me-1" aria-hidden="true" />
              <span className="d-none d-sm-inline">Settings</span>
            </button>
            <button
              type="button"
              className="btn btn-outline-secondary"
              onClick={resetDraft}
              disabled={!draftCurrent?.edited}
              title="Undo every timeline edit"
            >
              <i className="bi bi-arrow-counterclockwise" aria-hidden="true" />
              <span className="d-none d-sm-inline ms-1">Reset</span>
            </button>
          </div>
        ) : (
          <form action={clearAction}>
            <input type="hidden" name="rangeStart" value={rangeBounds.from.toISOString()} />
            <input type="hidden" name="rangeEnd" value={rangeBounds.to.toISOString()} />
            <ClearButton count={replaceable.length} blocked={planLimited} />
          </form>
        )}

        <form action={confirmAction} className="d-flex gap-2 ms-auto">
          <input type="hidden" name="payload" value={payload} />
          <button type="button" className="btn btn-outline-secondary d-none d-sm-inline-block" onClick={onClose}>
            Cancel
          </button>
          {step === 'settings' && activeBlocks.length > 0 && (
            <button type="button" className="btn btn-outline-primary" onClick={openReview}>
              <i className="bi bi-arrows-move me-1" aria-hidden="true" />
              Review
            </button>
          )}
          <ConfirmButton
            count={activeBlocks.length}
            replacing={replace ? replaceable.length : 0}
            blocked={(step === 'review' && issueCounts.past > 0) || planLimited}
          />
        </form>
      </div>
    </>
  )
}
