import type { Metadata } from 'next'
import Link from 'next/link'
import AssistantShowcase from '@/components/assistant/AssistantShowcase'
import styles from './page.module.css'

export const metadata: Metadata = { title: 'Isagi assistant preview' }

export default function AssistantDemoPage() {
  return (
    <main id="main" className={styles.page}>
      <div className={styles.content}>
        <Link href="/dashboard" className={styles.back}>← Back to FlowState</Link>
        <header className={styles.header}>
          <span>ISAGI · ASSISTANT PREVIEW</span>
          <h1>Every state, a different signal.</h1>
          <p>Select a state to inspect the animation and eyes.</p>
        </header>
        <AssistantShowcase />
        <p className={styles.sources}>Visual references: <a href="https://tv.bluelock-pr.com/tv1st/character/" target="_blank" rel="noreferrer">official character design</a> and <a href="https://bluelock.fandom.com/wiki/Metavision" target="_blank" rel="noreferrer">meta vision eye motif</a>. Omni vision uses the requested white/glowing interpretation. This preview uses no account or calendar data.</p>
      </div>
    </main>
  )
}
