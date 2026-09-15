import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { auth, signIn } from '@/auth'
import { AuthCard } from '@/components/auth/AuthCard'
import { SignInForm } from '@/components/auth/SignInForm'

export const metadata: Metadata = { title: 'Sign in' }

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; code?: string }>
}) {
  const { code } = await searchParams
  // proxy.ts already bounces signed-in visitors, but a direct hit should not
  // show a sign-in form to someone who is already authenticated.
  const session = await auth()
  if (session?.user?.id) redirect('/dashboard')

  const githubConfigured = Boolean(
    process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET,
  )

  return (
    <AuthCard
      title="Sign in"
      subtitle="Pick up your schedule where you left it."
      footer={
        <>
          No account yet?{' '}
          <Link href="/register" className="fw-medium">
            Create one
          </Link>
        </>
      }
    >
      <SignInForm
        notice={
          // Set by Auth.js when a sign-in posted directly to its endpoint was
          // refused for volume. The wait is not in the URL, so it is described.
          code === 'rate_limited'
            ? 'Too many sign-in attempts. Wait a few minutes, then try again.'
            : undefined
        }
      />

      {githubConfigured && (
        <>
          <div className="d-flex align-items-center gap-3 my-4">
            <hr className="flex-grow-1 m-0" />
            <span className="text-secondary small">or</span>
            <hr className="flex-grow-1 m-0" />
          </div>

          <form
            action={async () => {
              'use server'
              await signIn('github', { redirectTo: '/dashboard' })
            }}
          >
            <button type="submit" className="btn btn-outline-secondary w-100">
              <i className="bi bi-github me-2" aria-hidden="true" />
              Continue with GitHub
            </button>
          </form>
        </>
      )}
    </AuthCard>
  )
}
