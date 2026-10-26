'use client'

import { useState } from 'react'
import { IsagiAvatar } from './IsagiAvatar'
import styles from './showcase.module.css'

const STATES = [
  { id: 'idle', title: 'Idle', detail: 'Breathing, blinking, ready.', vision: 'normal', motion: 'idle' },
  { id: 'walking', title: 'Walking', detail: 'A stride when you move him.', vision: 'normal', motion: 'walking' },
  { id: 'meta', title: 'Meta vision', detail: 'Green puzzle eyes. Scanning.', vision: 'meta', motion: 'idle' },
  { id: 'omni', title: 'Omni vision', detail: 'White glow. A different gaze.', vision: 'omni', motion: 'idle' },
] as const

/** Visual-only demo of the production avatar. No AI calls or calendar access. */
export default function AssistantShowcase() {
  const [selected, setSelected] = useState<(typeof STATES)[number]>(STATES[0])
  return (
    <div className={styles.showcase}>
      <div className={styles.grid}>
        {STATES.map(state => (
          <button className={styles.card} key={state.id} aria-pressed={selected.id === state.id} onClick={() => setSelected(state)} type="button">
            <span className={`${styles.figure} ${state.motion === 'walking' ? styles.walking : ''}`}>
              <IsagiAvatar vision={state.vision} motion={state.motion} />
            </span>
            <strong>{state.title}</strong>
            <span>{state.detail}</span>
          </button>
        ))}
      </div>
      <section className={styles.inspector} aria-label={`${selected.title} close-up`}>
        <div>
          <p className={styles.kicker}>A CLOSER LOOK</p>
          <h2>{selected.title}</h2>
          <p>{selected.id === 'meta' ? 'Navy hair stays. Concentric green irises carry Isagi’s puzzle motif.' : selected.id === 'omni' ? 'Icy white hair and luminous cyan eyes make this evolution distinct from meta vision.' : selected.id === 'walking' ? 'Opposing arms and legs, a small body bounce, and a grounded step.' : 'A quiet breathing cycle and occasional blink keep him present without taking over.'}</p>
        </div>
        <div className={styles.closeup} aria-hidden="true"><IsagiAvatar vision={selected.vision} motion="idle" /></div>
      </section>
      <p className={styles.note}>Thinking moves from meta vision into omni vision on longer requests. Reduced motion keeps the visual states and softens movement.</p>
    </div>
  )
}
