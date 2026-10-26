'use client'

import dynamic from 'next/dynamic'

// Browser positioning and avatar code stay in their own dashboard client chunk.
const FloatingAssistant = dynamic(() => import('./FloatingAssistant'), { ssr: false })

export default function AssistantLoader() {
  return <FloatingAssistant />
}
