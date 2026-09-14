import type { Metadata } from 'next'
import { auth } from '@/auth'
import { getLook, getProgress } from '@/lib/data/progress'
import { chooseAvatarAction, chooseSeasonAction } from '@/lib/actions/rewards'
import { AVATARS, SEASONS, XP_RULES, evaluateAchievements } from '@/lib/gamification'
import { PlayerCard } from '@/components/rewards/PlayerCard'
import { PixelAvatar, PixelGlyph, PixelScene } from '@/components/rewards/Pixel'

export const metadata: Metadata = { title: 'Rewards' }
export const dynamic = 'force-dynamic'

/**
 * Avatars, seasons, badges and how XP is earned.
 *
 * Equip buttons are plain forms posting Server Actions, and every unlock is
 * re-checked on the server, so nothing here depends on client state.
 */
export default async function RewardsPage() {
  const session = await auth()
  const [progress, look] = await Promise.all([getProgress(), getLook()])
  const achievements = evaluateAchievements(progress)
  const earned = achievements.filter((a) => a.unlocked).length
  const firstName = session?.user?.name?.split(' ')[0] ?? null

  return (
    <>
      <header className="mb-4">
        <h1 className="h3 fw-semibold mb-1">Rewards</h1>
        <p className="text-secondary mb-0">
          Every finished block earns XP. XP unlocks avatars, seasons and badges.
        </p>
      </header>

      <PlayerCard name={firstName} look={look} progress={progress} showLink={false} />

      <section className="card mb-4" aria-labelledby="avatars-heading">
        <div className="card-header bg-transparent d-flex align-items-center justify-content-between">
          <h2 id="avatars-heading" className="h6 fw-semibold mb-0">Avatars</h2>
          <span className="text-secondary small">
            {AVATARS.filter((a) => progress.totalXP >= a.xp).length} of {AVATARS.length} unlocked
          </span>
        </div>
        <div className="card-body">
          <div className="row row-cols-2 row-cols-sm-3 row-cols-lg-5 g-3">
            {AVATARS.map((avatar) => {
              const unlocked = progress.totalXP >= avatar.xp
              const equipped = look.avatar.id === avatar.id
              return (
                <div key={avatar.id} className="col">
                  <div className={`reward-tile h-100${unlocked ? '' : ' is-locked'}${equipped ? ' is-equipped' : ''}`}>
                    <div className="reward-tile-art">
                      <PixelAvatar id={avatar.id} size={72} label={`${avatar.name} avatar`} />
                      {!unlocked && <i className="bi bi-lock-fill reward-lock" aria-hidden="true" />}
                    </div>
                    <div className="fw-semibold">{avatar.name}</div>
                    <div className="text-secondary small mb-2">{avatar.blurb}</div>
                    <div className="mt-auto">
                      {equipped ? (
                        <span className="badge text-bg-primary">
                          <i className="bi bi-check-lg me-1" aria-hidden="true" />
                          Equipped
                        </span>
                      ) : unlocked ? (
                        <form action={chooseAvatarAction}>
                          <input type="hidden" name="avatar" value={avatar.id} />
                          <button type="submit" className="btn btn-sm btn-outline-primary">
                            Equip
                          </button>
                        </form>
                      ) : (
                        <UnlockMeter have={progress.totalXP} need={avatar.xp} />
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
          {!look.avatarChosen && (
            <p className="text-secondary small mt-3 mb-0">
              Until you equip one, you wear the highest avatar you have unlocked.
            </p>
          )}
        </div>
      </section>

      <section className="card mb-4" aria-labelledby="seasons-heading">
        <div className="card-header bg-transparent d-flex align-items-center justify-content-between">
          <h2 id="seasons-heading" className="h6 fw-semibold mb-0">Seasons</h2>
          <span className="text-secondary small">Backgrounds for your player card</span>
        </div>
        <div className="card-body">
          <div className="row row-cols-1 row-cols-sm-2 row-cols-lg-4 g-3">
            {SEASONS.map((season) => {
              const unlocked = progress.totalXP >= season.xp
              const equipped = look.season.id === season.id
              return (
                <div key={season.id} className="col">
                  <div className={`season-tile h-100${unlocked ? '' : ' is-locked'}${equipped ? ' is-equipped' : ''}`}>
                    <div className="season-tile-art">
                      <PixelScene season={season.id} />
                      {!unlocked && <i className="bi bi-lock-fill reward-lock" aria-hidden="true" />}
                    </div>
                    <div className="p-3 d-flex align-items-center justify-content-between gap-2">
                      <div className="min-width-0">
                        <div className="fw-semibold">{season.name}</div>
                        <div className="text-secondary small text-truncate">{season.blurb}</div>
                      </div>
                      {equipped ? (
                        <span className="badge text-bg-primary flex-shrink-0">Equipped</span>
                      ) : unlocked ? (
                        <form action={chooseSeasonAction} className="flex-shrink-0">
                          <input type="hidden" name="season" value={season.id} />
                          <button type="submit" className="btn btn-sm btn-outline-primary">
                            Equip
                          </button>
                        </form>
                      ) : (
                        <span className="chip flex-shrink-0">{season.xp} XP</span>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      <div className="row g-4">
        <div className="col-12 col-lg-8">
          <section className="card h-100" aria-labelledby="badges-heading">
            <div className="card-header bg-transparent d-flex align-items-center justify-content-between">
              <h2 id="badges-heading" className="h6 fw-semibold mb-0">Badges</h2>
              <span className="text-secondary small">
                {earned} of {achievements.length} earned
              </span>
            </div>
            <div className="card-body">
              <div className="row row-cols-1 row-cols-sm-2 row-cols-xl-3 g-3">
                {achievements.map((a) => (
                  <div key={a.id} className="col">
                    <div className={`badge-tile h-100${a.unlocked ? '' : ' is-locked'}`}>
                      <span className="badge-frame">
                        <PixelGlyph glyph={a.glyph} size={32} />
                      </span>
                      <div className="min-width-0 flex-grow-1">
                        <div className="fw-semibold small">{a.title}</div>
                        <div className="text-secondary" style={{ fontSize: '0.75rem' }}>
                          {a.description}
                        </div>
                        {a.unlocked ? (
                          <div className="text-success mt-1" style={{ fontSize: '0.75rem' }}>
                            <i className="bi bi-check-circle-fill me-1" aria-hidden="true" />
                            Earned
                          </div>
                        ) : (
                          <div className="mt-2">
                            <div
                              className="stat-meter"
                              role="progressbar"
                              aria-label={`${a.title} progress`}
                              aria-valuemin={0}
                              aria-valuemax={100}
                              aria-valuenow={Math.round(a.progress * 100)}
                            >
                              <span style={{ width: `${a.progress * 100}%` }} />
                            </div>
                            <div className="text-secondary mt-1" style={{ fontSize: '0.7rem' }}>
                              {a.progressLabel}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </div>

        <div className="col-12 col-lg-4">
          <section className="card h-100" aria-labelledby="xp-heading">
            <div className="card-header bg-transparent">
              <h2 id="xp-heading" className="h6 fw-semibold mb-0">How XP works</h2>
            </div>
            <ul className="list-group list-group-flush small">
              <li className="list-group-item bg-transparent d-flex gap-2">
                <PixelGlyph glyph="book" size={20} />
                <span>
                  <strong>{XP_RULES.xpPerBlock} XP</strong> for every {XP_RULES.blockMinutes} minutes you
                  complete, once the block has started.
                </span>
              </li>
              <li className="list-group-item bg-transparent d-flex gap-2">
                <PixelGlyph glyph="apple" size={20} />
                <span>
                  <strong>+{XP_RULES.fullDayBonus} XP</strong> when every timed event in a day is done.
                </span>
              </li>
              <li className="list-group-item bg-transparent d-flex gap-2">
                <PixelGlyph glyph="flame" size={20} />
                <span>
                  Streaks multiply block XP by up to <strong>{XP_RULES.maxStreakMultiplier}×</strong>, and
                  every {XP_RULES.streakBonusEvery}th day in a row adds{' '}
                  <strong>+{XP_RULES.streakBonus} XP</strong>.
                </span>
              </li>
            </ul>
            <div className="card-body border-top">
              <h3 className="small fw-semibold mb-2">Your XP so far</h3>
              <dl className="row small mb-0">
                <dt className="col-8 fw-normal text-secondary">Completed blocks</dt>
                <dd className="col-4 text-end tnum mb-1">{progress.xp.blocks.toLocaleString('en-GB')}</dd>
                <dt className="col-8 fw-normal text-secondary">Streak multiplier</dt>
                <dd className="col-4 text-end tnum mb-1">+{progress.xp.streakMultiplier.toLocaleString('en-GB')}</dd>
                <dt className="col-8 fw-normal text-secondary">Full days</dt>
                <dd className="col-4 text-end tnum mb-1">+{progress.xp.fullDays.toLocaleString('en-GB')}</dd>
                <dt className="col-8 fw-normal text-secondary">Streak bonuses</dt>
                <dd className="col-4 text-end tnum mb-1">+{progress.xp.streakBonuses.toLocaleString('en-GB')}</dd>
                <dt className="col-8 fw-semibold border-top pt-1">Total</dt>
                <dd className="col-4 text-end tnum fw-semibold border-top pt-1 mb-0">
                  {progress.totalXP.toLocaleString('en-GB')}
                </dd>
              </dl>
            </div>
          </section>
        </div>
      </div>
    </>
  )
}

function UnlockMeter({ have, need }: { have: number; need: number }) {
  const pct = Math.min(100, Math.round((have / need) * 100))
  return (
    <div>
      <div
        className="stat-meter"
        role="progressbar"
        aria-label={`${have} of ${need} XP`}
        aria-valuemin={0}
        aria-valuemax={need}
        aria-valuenow={have}
      >
        <span style={{ width: `${pct}%` }} />
      </div>
      <div className="text-secondary mt-1" style={{ fontSize: '0.7rem' }}>
        {have.toLocaleString('en-GB')} / {need.toLocaleString('en-GB')} XP
      </div>
    </div>
  )
}
