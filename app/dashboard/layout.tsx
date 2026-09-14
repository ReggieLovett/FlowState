import Link from 'next/link'
import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { MobileNav } from '@/components/dashboard/MobileNav'
import { SidebarNav } from '@/components/dashboard/SidebarNav'
import { UserMenu } from '@/components/dashboard/UserMenu'
import { ThemeToggle } from '@/components/bootstrap/ThemeToggle'
import { LevelPill } from '@/components/rewards/LevelPill'
import { RewardToaster } from '@/components/rewards/RewardToaster'
import { getLook, getProgress } from '@/lib/data/progress'

/**
 * Shell for every signed-in screen.
 *
 * The session is resolved once here and the layout redirects if it is missing.
 * proxy.ts already does this at the edge; repeating it means a page is never
 * rendered without a user even if middleware is bypassed or misconfigured.
 */
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await auth()
  if (!session?.user?.id) redirect('/login')

  // Cached per request, so a page that also shows progress does not re-query.
  const [progress, look] = await Promise.all([getProgress(), getLook()])

  return (
    <div className="d-lg-flex" data-season={look.season.id}>
      <aside
        className="app-sidebar d-none d-lg-flex flex-column p-3 flex-shrink-0"
        style={{ width: '15.5rem' }}
      >
        <Link
          href="/dashboard"
          className="d-flex align-items-center gap-2 text-decoration-none px-2 mb-4"
        >
          <span
            className="d-inline-flex align-items-center justify-content-center rounded-3 bg-primary text-white"
            style={{ width: '1.875rem', height: '1.875rem' }}
          >
            <i className="bi bi-calendar2-week" aria-hidden="true" />
          </span>
          <span className="fw-semibold text-body">FlowState</span>
        </Link>

        <SidebarNav />
      </aside>

      <div className="flex-grow-1" style={{ minWidth: 0 }}>
        <header className="border-bottom sticky-top bg-body">
          <div className="d-flex align-items-center justify-content-between gap-3 px-3 px-lg-4 py-2">
            <div className="d-flex align-items-center gap-2">
              <MobileNav />
              <Link
                href="/dashboard"
                className="d-lg-none fw-semibold text-body text-decoration-none"
              >
                FlowState
              </Link>
            </div>

            <div className="d-flex align-items-center gap-2">
              <LevelPill look={look} progress={progress} />
              <ThemeToggle />
              <UserMenu name={session.user.name ?? null} email={session.user.email ?? ''} />
            </div>
          </div>
        </header>

        <main id="main" className="px-3 px-lg-4 py-4">
          {children}
        </main>
        <RewardToaster />
      </div>
    </div>
  )
}
