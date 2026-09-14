import type { Metadata } from 'next'
import Link from 'next/link'
import { auth } from '@/auth'
import { getDashboardSummary, listEventsInRange } from '@/lib/data/schedule'
import { listSubjects } from '@/lib/data/subjects'
import { listItems } from '@/lib/data/items'
import { ITEM_LABELS } from '@/lib/scheduling'
import { getLook, getProgress } from '@/lib/data/progress'
import { CATEGORY_META, CATEGORY_ORDER } from '@/lib/categories'
import { EmptyState } from '@/components/dashboard/EmptyState'
import { EventList } from '@/components/schedule/EventList'
import { PlayerCard } from '@/components/rewards/PlayerCard'
import { StatTiles } from '@/components/progress/StatTiles'
import { WeekChart } from '@/components/progress/WeekChart'
import { StreakCalendar } from '@/components/progress/StreakCalendar'
import { SubjectBreakdown } from '@/components/progress/SubjectBreakdown'
import { addDays, formatLongDay, relativeDays, startOfWeek } from '@/lib/format'

export const metadata: Metadata = { title: 'Overview' }

// The page is per-user and time-sensitive, so it must never be cached.
export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const session = await auth()
  const userName = session?.user?.name?.split(' ')[0] ?? null
  const now = new Date()
  const todayStart = new Date(now)
  todayStart.setHours(0, 0, 0, 0)
  const todayEnd = addDays(todayStart, 1)

  const weekStart = startOfWeek(now)
  const weekEnd = addDays(weekStart, 7)

  // User-scoped reads. None takes a userId; each derives it from the session
  // inside the data layer. Progress and look are cached per request, so the
  // layout's copies cost nothing extra.
  const [todayEvents, summary, subjects, progress, look, openItems] = await Promise.all([
    listEventsInRange(todayStart, todayEnd),
    getDashboardSummary(weekStart, weekEnd),
    listSubjects({ includeArchived: true }),
    getProgress(),
    getLook(),
    listItems({ status: 'TODO' }),
  ])

  const activeSubjects = subjects.filter((s) => !s.archivedAt)
  const counts = new Map(summary.byCategory.map((row) => [row.category, row._count._all]))

  // Exams from subjects, open subject items, and deadline events, next two
  // weeks, one list. Item due dates are date-only values at UTC midnight, so
  // they are read back as that calendar day in local time.
  const horizon = addDays(todayStart, 15)
  const subjectById = new Map(activeSubjects.map((s) => [s.id, s]))
  const upcoming = [
    ...openItems
      .filter((item) => item.dueDate && subjectById.has(item.subjectId))
      .map((item) => {
        const due = item.dueDate!
        const subject = subjectById.get(item.subjectId)!
        return {
          id: `item-${item.id}`,
          title: item.title,
          detail: `${subject.name} · ${ITEM_LABELS[item.type].label}`,
          date: new Date(due.getUTCFullYear(), due.getUTCMonth(), due.getUTCDate()),
          color: subject.colorHex,
          icon: ITEM_LABELS[item.type].icon,
        }
      })
      // Overdue items stay on the list; they are the ones that most need seeing.
      .filter((item) => item.date < horizon),
    ...activeSubjects
      .filter((s) => s.examDate && s.examDate >= todayStart && s.examDate < horizon)
      .map((s) => ({
        id: `exam-${s.id}`,
        title: `${s.name} exam`,
        detail: s.code ?? 'Exam',
        date: s.examDate!,
        color: s.colorHex,
        icon: 'bi-mortarboard',
      })),
    ...summary.upcomingDeadlines
      .filter((e) => e.startsAt < horizon)
      .map((e) => ({
        id: e.id,
        title: e.title,
        detail: e.subject?.name ?? CATEGORY_META[e.category].label,
        date: e.startsAt,
        color: e.subject?.colorHex ?? CATEGORY_META[e.category].colorHex,
        icon: 'bi-flag',
      })),
  ]
    .sort((a, b) => a.date.getTime() - b.date.getTime())
    .slice(0, 6)

  return (
    <>
      <header className="mb-4">
        <h1 className="h3 fw-semibold mb-1">
          {userName ? `Welcome back, ${userName}` : 'Today'}
        </h1>
        <p className="text-secondary mb-0">{formatLongDay(now)}</p>
      </header>

      <PlayerCard name={userName} look={look} progress={progress} />
      <StatTiles progress={progress} />

      <div className="row g-4">
        <div className="col-12 col-xl-7">
          <div className="card h-100">
            <div className="card-header bg-transparent d-flex align-items-center justify-content-between">
              <h2 className="h6 fw-semibold mb-0">Your day</h2>
              <Link href="/dashboard/schedule" className="small text-decoration-none">
                Full schedule
              </Link>
            </div>

            {todayEvents.length === 0 ? (
              <EmptyState
                icon="bi-calendar2-check"
                title="Nothing scheduled today"
                description="Add a lecture, a client meeting or a deep work shift and it will appear here."
                action={
                  <Link href="/dashboard/schedule" className="btn btn-primary btn-sm">
                    Go to schedule
                  </Link>
                }
              />
            ) : (
              <EventList events={todayEvents} />
            )}
          </div>
        </div>

        <div className="col-12 col-xl-5">
          <div className="card mb-4">
            <div className="card-header bg-transparent">
              <h2 className="h6 fw-semibold mb-0">This week</h2>
            </div>
            <div className="card-body">
              <div className="mb-4">
                <WeekChart week={progress.week} />
              </div>

              <p className="text-secondary small mb-3">
                <span className="tnum fw-semibold text-body fs-5">{summary.totalEvents}</span>{' '}
                commitments between {formatLongDay(weekStart)} and {formatLongDay(addDays(weekEnd, -1))}
              </p>

              <ul className="list-unstyled mb-0 d-flex flex-column gap-2">
                {CATEGORY_ORDER.filter((category) => counts.get(category)).map((category) => {
                  const meta = CATEGORY_META[category]
                  return (
                    <li key={category} className="d-flex align-items-center gap-2">
                      <span
                        className="category-dot"
                        style={{ ['--dot-color' as string]: meta.colorHex }}
                        aria-hidden="true"
                      />
                      <span className="small flex-grow-1">{meta.plural}</span>
                      <span className="tnum small text-secondary">{counts.get(category)}</span>
                    </li>
                  )
                })}
                {summary.totalEvents === 0 && (
                  <li className="small text-secondary">Nothing scheduled this week yet.</li>
                )}
              </ul>
            </div>
          </div>

          <div className="card">
            <div className="card-header bg-transparent d-flex align-items-center justify-content-between">
              <h2 className="h6 fw-semibold mb-0">Exams and deadlines</h2>
              <span className="text-secondary small">Next 2 weeks</span>
            </div>

            {upcoming.length === 0 ? (
              <div className="card-body">
                <p className="text-secondary small mb-0">
                  Nothing due in the next two weeks. Add an exam, assignment or task with a
                  due date to a subject and it will be tracked here.
                </p>
              </div>
            ) : (
              <ul className="list-group list-group-flush">
                {upcoming.map((item) => (
                  <li
                    key={item.id}
                    className="list-group-item event-row d-flex align-items-center justify-content-between gap-3 bg-transparent"
                    style={{ ['--event-color' as string]: item.color }}
                  >
                    <div className="min-width-0">
                      <div className="small fw-medium text-truncate">
                        <i className={`bi ${item.icon} text-secondary me-1`} aria-hidden="true" />
                        {item.title}
                      </div>
                      <div className="text-secondary" style={{ fontSize: '0.75rem' }}>
                        {item.detail}
                      </div>
                    </div>
                    <span className="badge text-bg-secondary tnum flex-shrink-0">
                      {relativeDays(item.date, now)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      <div className="row g-4 mt-2">
        <div className="col-12 col-xl-7">
          <div className="card h-100">
            <div className="card-header bg-transparent d-flex align-items-center justify-content-between">
              <h2 className="h6 fw-semibold mb-0">Study streak</h2>
              <Link href="/dashboard/rewards" className="small text-decoration-none">
                Rewards
              </Link>
            </div>
            <div className="card-body">
              <StreakCalendar progress={progress} />
            </div>
          </div>
        </div>

        <div className="col-12 col-xl-5">
          <div className="card h-100">
            <div className="card-header bg-transparent d-flex align-items-center justify-content-between">
              <h2 className="h6 fw-semibold mb-0">Time by subject</h2>
              <span className="text-secondary small">Last 30 days</span>
            </div>
            <div className="card-body">
              <SubjectBreakdown progress={progress} subjects={subjects} />
            </div>
          </div>
        </div>
      </div>

      <div className="row g-4 mt-2">
        <div className="col-12 col-xl-6">
          <div className="card h-100">
            <div className="card-header bg-transparent d-flex align-items-center justify-content-between">
              <h2 className="h6 fw-semibold mb-0">Your subjects</h2>
              <Link href="/dashboard/subjects" className="small text-decoration-none">
                Manage
              </Link>
            </div>

            {activeSubjects.length === 0 ? (
              <EmptyState
                icon="bi-collection"
                title="No subjects yet"
                description="Add your first subject to start building your schedule."
                action={
                  <Link href="/dashboard/subjects" className="btn btn-primary btn-sm">
                    Add a subject
                  </Link>
                }
              />
            ) : (
              <ul className="list-group list-group-flush">
                {activeSubjects.slice(0, 6).map((subject) => {
                  const meta = CATEGORY_META[subject.category]
                  return (
                    <li
                      key={subject.id}
                      className="list-group-item d-flex align-items-center gap-3 bg-transparent"
                    >
                      <span
                        className="flex-shrink-0 rounded"
                        style={{
                          width: '4px',
                          height: '1.75rem',
                          background: subject.colorHex,
                        }}
                        aria-hidden="true"
                      />
                      <div className="min-width-0 flex-grow-1">
                        <div className="small fw-medium text-truncate">{subject.name}</div>
                        <div className="text-secondary" style={{ fontSize: '0.75rem' }}>
                          {meta.label}
                          {subject.code ? ` · ${subject.code}` : ''}
                        </div>
                      </div>
                      <span className="text-secondary small tnum flex-shrink-0">
                        {subject._count.events}{' '}
                        {subject._count.events === 1 ? 'event' : 'events'}
                      </span>
                    </li>
                  )
                })}
                {activeSubjects.length > 6 && (
                  <li className="list-group-item bg-transparent text-center">
                    <Link
                      href="/dashboard/subjects"
                      className="small text-decoration-none"
                    >
                      +{activeSubjects.length - 6} more
                    </Link>
                  </li>
                )}
              </ul>
            )}
          </div>
        </div>

        <div className="col-12 col-xl-6">
          <div className="card h-100">
            <div className="card-header bg-transparent d-flex align-items-center justify-content-between">
              <h2 className="h6 fw-semibold mb-0">Quick schedule</h2>
              <Link href="/dashboard/schedule" className="small text-decoration-none">
                Full view
              </Link>
            </div>
            <div className="card-body">
              <p className="text-secondary small mb-3">
                You have{' '}
                <span className="tnum fw-semibold text-body">{todayEvents.length}</span>{' '}
                {todayEvents.length === 1 ? 'commitment' : 'commitments'} today and{' '}
                <span className="tnum fw-semibold text-body">{summary.totalEvents}</span>{' '}
                this week.
              </p>
              <div className="d-flex flex-wrap gap-2">
                <Link
                  href="/dashboard/schedule"
                  className="btn btn-primary btn-sm"
                >
                  <i className="bi bi-calendar-week me-1" aria-hidden="true" />
                  View schedule
                </Link>
                <Link
                  href="/dashboard/subjects"
                  className="btn btn-outline-secondary btn-sm"
                >
                  <i className="bi bi-collection me-1" aria-hidden="true" />
                  Manage subjects
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
