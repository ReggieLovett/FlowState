import type { Metadata, Viewport } from 'next'
import { Inter, Press_Start_2P } from 'next/font/google'
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

// Accent face for levels, XP and reward titles only, as the original spec had
// it. Body text stays in Inter.
const pixel = Press_Start_2P({
  subsets: ['latin'],
  weight: '400',
  variable: '--font-pixel',
  display: 'swap',
})

export const metadata: Metadata = {
  title: {
    default: 'FlowState',
    template: '%s · FlowState',
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
    // The font variables go on <html>, not <body>. theme.css reads them inside
    // :root, and a custom property that references a variable :root cannot see
    // resolves to nothing, which had been dropping every page to the browser's
    // default serif.
    <html lang="en" className={`${inter.variable} ${pixel.variable}`} suppressHydrationWarning>
      <head>
        <ThemeScript />
      </head>
      <body>
        <a href="#main" className="visually-hidden-focusable btn btn-primary m-2">
          Skip to content
        </a>
        {children}
        <BootstrapClient />
      </body>
    </html>
  )
}
