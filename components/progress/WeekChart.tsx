import type { WeekBar } from '@/lib/gamification'
import { formatMinutes } from '@/lib/format'

const WEEKDAY = new Intl.DateTimeFormat('en-GB', { weekday: 'short' })
const LONG = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })

function parse(iso: string) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/**
 * Completed against planned minutes, Monday to Sunday.
 *
 * Planned is the track and completed the fill inside it, both on one
 * baseline and one scale, like a meter per day: the gap between them is the
 * story. Columns are focusable so the per-day tooltip is reachable by
 * keyboard, and a visually hidden table carries the same numbers.
 */
export function WeekChart({ week }: { week: WeekBar[] }) {
  const peak = Math.max(60, ...week.map((d) => Math.max(d.plannedMinutes, d.completedMinutes)))
  const scaleMax = Math.ceil(peak / 60) * 60
  const today = week.find((d) => d.isToday)

  return (
    <figure className="mb-0">
      <div className="d-flex align-items-center justify-content-between mb-2">
        <figcaption className="small fw-medium">Study time by day</figcaption>
        <div className="chart-legend" aria-hidden="true">
          <span><i className="legend-swatch legend-done" />Completed</span>
          <span><i className="legend-swatch legend-planned" />Planned</span>
        </div>
      </div>

      <div className="week-chart" aria-hidden="true">
        <div className="week-chart-axis">
          <span>{formatMinutes(scaleMax)}</span>
          <span>0</span>
        </div>
        <div className="week-chart-plot">
          {week.map((day) => {
            const date = parse(day.date)
            const plannedPct = (day.plannedMinutes / scaleMax) * 100
            const donePct = (day.completedMinutes / scaleMax) * 100
            return (
              <div
                key={day.date}
                className={`week-col chart-tip${day.isToday ? ' is-today' : ''}`}
                tabIndex={0}
                data-tip={`${LONG.format(date)} · ${formatMinutes(day.completedMinutes)} of ${formatMinutes(day.plannedMinutes)}`}
              >
                <div className="week-bars">
                  <span className="week-track" style={{ height: `${plannedPct}%` }} />
                  <span className="week-fill" style={{ height: `${donePct}%` }} />
                  {day.isToday && day.completedMinutes > 0 && (
                    <span className="week-value" style={{ bottom: `${donePct}%` }}>
                      {formatMinutes(day.completedMinutes)}
                    </span>
                  )}
                </div>
                <span className="week-label">{WEEKDAY.format(date).slice(0, 2)}</span>
              </div>
            )
          })}
        </div>
      </div>

      <table className="visually-hidden">
        <caption>Study time by day this week{today ? `, today is ${LONG.format(parse(today.date))}` : ''}</caption>
        <thead>
          <tr>
            <th scope="col">Day</th>
            <th scope="col">Completed</th>
            <th scope="col">Planned</th>
          </tr>
        </thead>
        <tbody>
          {week.map((day) => (
            <tr key={day.date}>
              <th scope="row">{LONG.format(parse(day.date))}</th>
              <td>{formatMinutes(day.completedMinutes)}</td>
              <td>{formatMinutes(day.plannedMinutes)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  )
}
