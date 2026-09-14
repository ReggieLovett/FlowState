import type { HeatCell, Progress } from '@/lib/gamification'
import { formatMinutes } from '@/lib/format'
import { PixelGlyph } from '@/components/rewards/Pixel'

const MONTH = new Intl.DateTimeFormat('en-GB', { month: 'short' })
const LONG = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })

function parse(iso: string) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function describe(cell: HeatCell) {
  const label = LONG.format(parse(cell.date))
  if (cell.isFuture) return `${label} · still to come`
  return cell.minutes === 0 ? `${label} · no study` : `${label} · ${formatMinutes(cell.minutes)} studied`
}

/**
 * Eighteen weeks of study days, one column per week.
 *
 * One hue, light to dark, in five steps: nothing, then quartiles of the user's
 * own active days. The streak is the thing to read, so the current and longest
 * runs are stated in words above the grid rather than left to the colours.
 */
export function StreakCalendar({ progress }: { progress: Progress }) {
  const { heatmap, streak } = progress
  const activeDays = heatmap.flat().filter((c) => !c.isFuture && c.minutes > 0).length

  return (
    <figure className="mb-0">
      <div className="d-flex flex-wrap align-items-center gap-3 mb-3">
        <span className="d-inline-flex align-items-center gap-2">
          <PixelGlyph glyph="flame" size={20} />
          <span>
            <span className="fw-semibold">{streak.current}</span>
            <span className="text-secondary small"> day current streak</span>
          </span>
        </span>
        <span className="text-secondary small">
          Longest <span className="fw-semibold text-body">{streak.longest}</span>
        </span>
        <span className="text-secondary small">
          <span className="fw-semibold text-body">{activeDays}</span> study days in 18 weeks
        </span>
      </div>

      <div className="heatmap-scroll">
        <div className="heatmap" aria-hidden="true">
          <div className="heatmap-days">
            <span />
            <span>Mon</span>
            <span />
            <span>Wed</span>
            <span />
            <span>Fri</span>
            <span />
          </div>
          {heatmap.map((week, w) => {
            const first = parse(week[0].date)
            const previous = w > 0 ? parse(heatmap[w - 1][0].date) : null
            const showMonth = !previous || previous.getMonth() !== first.getMonth()
            return (
              <div key={week[0].date} className="heatmap-week">
                <span className="heatmap-month">{showMonth ? MONTH.format(first) : ''}</span>
                {week.map((cell) => (
                  <span
                    key={cell.date}
                    className={`heatmap-cell chart-tip level-${cell.level}${cell.isFuture ? ' is-future' : ''}`}
                    data-tip={describe(cell)}
                  />
                ))}
              </div>
            )
          })}
        </div>
      </div>

      <div className="d-flex justify-content-end align-items-center gap-1 mt-2 heatmap-legend" aria-hidden="true">
        <span className="me-1">Less</span>
        {[0, 1, 2, 3, 4].map((level) => (
          <span key={level} className={`heatmap-cell level-${level}`} />
        ))}
        <span className="ms-1">More</span>
      </div>

      <figcaption className="visually-hidden">
        Study calendar for the last 18 weeks. {activeDays} days with completed study. Current streak{' '}
        {streak.current} days, longest {streak.longest} days.
      </figcaption>
    </figure>
  )
}
