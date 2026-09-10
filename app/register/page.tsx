import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { AuthCard } from '@/components/auth/AuthCard'
import { SignUpForm } from '@/components/auth/SignUpForm'

export const metadata: Metadata = { title: 'Create account' }

export default async function RegisterPage() {
  const session = await auth()
  if (session?.user?.id) redirect('/dashboard')

  return (
    <AuthCard
      title="Create your account"
      subtitle="Your dashboard starts with a set of templates you can rename or delete."
      footer={
        <>
          Already have an account?{' '}
          <Link href="/login" className="fw-medium">
            Sign in
          </Link>
        </>
      }
    >
      <SignUpForm />
    </AuthCard>
  )
}
