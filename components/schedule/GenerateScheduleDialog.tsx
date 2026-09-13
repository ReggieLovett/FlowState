'use client'

import { useActionState, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useFormStatus } from 'react-dom'
import {
  DEFAULT_PREFS,
  addDaysISO,
  planSchedule,
  toISODate,
  type SchedulingPrefs,
  type SchedulingSubject,
} from '@/lib/scheduling'
import {
  clearGeneratedAction,
  confirmScheduleAction,
  type ConfirmState,
} from '@/lib/actions/scheduling'
import type { Category } from '@prisma/client'

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
}

type RangeKey = 'week' | 'fortnight' | 'month'

const RANGES: Record<RangeKey, { label: string; days: number }> = {
  week: { label: 'This week', days: 6 },
  fortnight: { label: 'Two weeks', days: 13 },
  month: { label: 'Four weeks', days: 27 },
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
function loadPrefs(): SchedulingPrefs {
  try {
    const raw = window.localStorage.getItem(PREFS_KEY)
    if (!raw) return DEFAULT_PREFS
    const parsed = JSON.parse(raw) as Partial<SchedulingPrefs>
    const merged = { ...DEFAULT_PREFS, ...parsed }
    return {
      ...merged,
      studyDays: Array.isArray(merged.studyDays) && merged.studyDays.length > 0
        ? merged.studyDays
        : DEFAULT_PREFS.studyDays,
    }
  } catch {
    return DEFAULT_PREFS
  }
}

function savePrefs(prefs: SchedulingPrefs) {
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
  } catch {
    // Storage disabled. The dialog still works, it just forgets.
  }
}

function ConfirmButton({ count, replacing }: { count: number; replacing: number }) {
  const { pending } = useFormStatus()
  return (
    <button type="submit" className="btn btn-primary" disabled={pending || count === 0}>
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

function ClearButton({ count }: { count: number }) {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      className="btn btn-outline-secondary"
      disabled={pending || count === 0}
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
  return (
    <div>
      <label htmlFor={id} className="form-label small fw-medium mb-1">
        {label}
      </label>
      <div className="input-group input-group-sm">
        <input
          id={id}
          type="number"
          className="form-control tnum"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(event) => {
            const next = Number(event.target.value)
            if (Number.isFinite(next)) onChange(Math.min(max, Math.max(min, next)))
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
  weekStartISO,
}: {
  open: boolean
  onClose: () => void
  subjects: SerialSubject[]
  events: SerialEvent[]
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
  weekStartISO,
}: {
  onClose: () => void
  subjects: SerialSubject[]
  events: SerialEvent[]
  weekStartISO: string
}) {
  const [range, setRange] = useState<RangeKey>('week')
  const [prefs, setPrefs] = useState<SchedulingPrefs>(loadPrefs)
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
        .filter((s) => s.examDate && toISODate(new Date(s.examDate)) < today)
        .map((s) => s.id),
    )
  })

  useEffect(() => savePrefs(prefs), [prefs])

  useEffect(() => {
    if (confirmState.ok || clearState.ok) onClose()
  }, [confirmState.ok, clearState.ok, onClose])

  const update = useCallback(
    (patch: Partial<SchedulingPrefs>) => setPrefs((current) => ({ ...current, ...patch })),
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
  const endDate = addDaysISO(weekStartIso, RANGES[range].days)

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

  /** Generated blocks the confirm would overwrite, counted for the button. */
  const replaceable = useMemo(
    () =>
      parsedEvents.filter(
        (event) =>
          event.isGenerated &&
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
        examDate: subject.examDate ? new Date(subject.examDate) : null,
      })),
    [included],
  )

  const plan = useMemo(() => {
    // With replace on, last run's blocks are about to disappear, so the planner
    // must not treat their slots as taken or count them against the daily goal.
    const visible = replace
      ? parsedEvents.filter(
          (event) =>
            !(
              event.isGenerated &&
              event.startsAt < rangeBounds.to &&
              event.endsAt > rangeBounds.from
            ),
        )
      : parsedEvents

    return planSchedule(schedulingSubjects, visible, startDate, endDate, prefs, {
      notBefore: todayIso,
      notBeforeMinutes: now.getHours() * 60 + now.getMinutes(),
    })
  }, [
    schedulingSubjects,
    parsedEvents,
    replace,
    rangeBounds,
    startDate,
    endDate,
    prefs,
    todayIso,
    now,
  ])

  const error = confirmState.error ?? clearState.error
  const maxPriority = Math.max(1, ...plan.scored.map((s) => s.priorityScore))

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const field = form.elements.namedItem('payload') as HTMLInputElement
    field.value = JSON.stringify({
      replace,
      rangeStart: rangeBounds.from.toISOString(),
      rangeEnd: rangeBounds.to.toISOString(),
      blocks: plan.blocks.map((block) => ({
        subjectId: block.subjectId,
        title: `${block.subjectName} · Focus block`,
        category: block.category,
        startsAt: block.startsAt.toISOString(),
        endsAt: block.endsAt.toISOString(),
      })),
    })
    form.requestSubmit()
  }

  return (
    <>
      <div className="d-flex align-items-center justify-content-between border-bottom px-4 py-3">
        <div className="min-width-0">
          <h2 className="h6 fw-semibold mb-0 d-flex align-items-center gap-2">
            <i className="bi bi-stars text-primary" aria-hidden="true" />
            Generate a study plan
          </h2>
          <p className="text-secondary mb-0 tnum" style={{ fontSize: '0.75rem' }}>
            {labelForDate(startDate)} to {labelForDate(endDate)}
          </p>
        </div>
        <button type="button" className="btn-close" aria-label="Close" onClick={onClose} />
      </div>

      <div className="plan-dialog-body">
        {error && (
          <div className="alert alert-danger py-2 px-3 small m-4 mb-0" role="alert">
            {error}
          </div>
        )}

        {subjects.length === 0 ? (
          <p className="text-secondary small m-4">
            Add subjects with difficulty ratings and exam dates first. The planner
            uses those to decide who gets your time.
          </p>
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
                          }. Your own events are untouched.`}
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
                      {formatDuration(plan.totalMinutes)} · {plan.totalBlocks} blocks ·{' '}
                      {plan.days} {plan.days === 1 ? 'day' : 'days'}
                    </span>
                  </div>

                  {plan.totalBlocks > 0 && (
                    <div className="plan-bar mb-3" aria-hidden="true">
                      {plan.bySubject
                        .filter((entry) => entry.minutes > 0)
                        .map((entry) => (
                          <span
                            key={entry.subject.id}
                            style={{
                              width: `${entry.share * 100}%`,
                              background: entry.subject.colorHex,
                            }}
                          />
                        ))}
                    </div>
                  )}

                  <ul className="list-unstyled mb-0 d-flex flex-column gap-2">
                    {included.length === 0 && (
                      <li className="text-secondary small">
                        Every subject is unticked. Tick one to build a plan.
                      </li>
                    )}

                    {subjects.map((subject) => {
                      const isIncluded = !excluded.has(subject.id)
                      const scored = plan.scored.find((s) => s.id === subject.id)
                      const entry = plan.bySubject.find((s) => s.subject.id === subject.id)
                      const inputId = `plan-subject-${subject.id}`

                      return (
                        <li key={subject.id} className="plan-subject">
                          <div className="d-flex align-items-start gap-2">
                            <input
                              className="form-check-input mt-1 flex-shrink-0"
                              type="checkbox"
                              id={inputId}
                              checked={isIncluded}
                              onChange={() =>
                                setExcluded((current) => {
                                  const next = new Set(current)
                                  if (next.has(subject.id)) next.delete(subject.id)
                                  else next.add(subject.id)
                                  return next
                                })
                              }
                            />
                            <label
                              htmlFor={inputId}
                              className={`flex-grow-1 min-width-0 ${
                                isIncluded ? '' : 'opacity-50'
                              }`}
                            >
                              <span className="d-flex align-items-baseline gap-2">
                                <span
                                  className="category-dot"
                                  style={{ ['--dot-color' as string]: subject.colorHex }}
                                  aria-hidden="true"
                                />
                                <span className="small fw-medium text-truncate flex-grow-1">
                                  {subject.name}
                                </span>
                                <span
                                  className="text-secondary tnum flex-shrink-0"
                                  style={{ fontSize: '0.75rem' }}
                                >
                                  {entry && entry.minutes > 0
                                    ? `${formatDuration(entry.minutes)} · ${entry.blocks} ${
                                        entry.blocks === 1 ? 'block' : 'blocks'
                                      }`
                                    : isIncluded
                                      ? 'no time'
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
                  <h3 className="h6 fw-semibold mb-2">Day by day</h3>

                  {plan.byDay.length === 0 ? (
                    <p className="text-secondary small mb-0 py-3 text-center border rounded">
                      No study days in this range. Add days of the week on the left.
                    </p>
                  ) : (
                    <ul className="list-unstyled mb-0 d-flex flex-column gap-2 plan-days">
                      {plan.byDay.map((day) => (
                        <li key={day.date} className="d-flex align-items-start gap-3">
                          <span
                            className="text-secondary small tnum flex-shrink-0 pt-1"
                            style={{ width: '5.5rem' }}
                          >
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
                                  key={`${block.date}-${block.startTime}`}
                                  className="plan-block"
                                  style={{ ['--block-color' as string]: block.subjectColor }}
                                  title={`${block.startTime} to ${block.endTime} · ${block.subjectName}`}
                                >
                                  <span className="tnum">{block.startTime}</span>
                                  <span className="text-truncate">{block.subjectName}</span>
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
        <form action={clearAction}>
          <input type="hidden" name="rangeStart" value={rangeBounds.from.toISOString()} />
          <input type="hidden" name="rangeEnd" value={rangeBounds.to.toISOString()} />
          <ClearButton count={replaceable.length} />
        </form>

        <form action={confirmAction} onSubmit={handleSubmit} className="d-flex gap-2 ms-auto">
          <input type="hidden" name="payload" value="" />
          <button type="button" className="btn btn-outline-secondary" onClick={onClose}>
            Cancel
          </button>
          <ConfirmButton
            count={plan.totalBlocks}
            replacing={replace ? replaceable.length : 0}
          />
        </form>
      </div>
    </>
  )
}
