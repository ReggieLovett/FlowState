import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import { BootstrapClient } from '@/components/bootstrap/BootstrapClient'
import { ThemeScript } from '@/components/bootstrap/ThemeScript'

// Bootstrap first, so the theme layer can override its custom properties.
import 'bootstrap/dist/css/bootstrap.min.css'
import 'bootstrap-icons/font/bootstrap-icons.css'
import './theme.css'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-app',
  display: 'swap',
})

export const metadata: Metadata = {
  title: {
    default: 'Cadence',
    template: '%s · Cadence',
  },
  description:
    'Plan lectures, labs, client meetings and deep work in one schedule. Built for students and working professionals.',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fbfaf8' },
    { media: '(prefers-color-scheme: dark)', color: '#16181a' },
  ],
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <ThemeScript />
      </head>
      <body className={inter.variable}>
        <a href="#main" className="visually-hidden-focusable btn btn-primary m-2">
          Skip to content
        </a>
        {children}
        <BootstrapClient />
      </body>
    </html>
  )
}
