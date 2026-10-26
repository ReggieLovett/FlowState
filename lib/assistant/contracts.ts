/** Browser-safe API contracts. Secrets, prompts and database clients stay server-side. */
export interface AssistantChange {
  eventId: string
  title: string
  fromStart: string
  fromEnd: string
  toStart: string
  toEnd: string
  reason: string
}

export interface AssistantProposal {
  id: string
  expiresAt: string
  changes: AssistantChange[]
}

export interface AssistantResponse {
  message: string
  proposal?: AssistantProposal
  calendar: { connected: boolean; warning?: string }
}

export interface AssistantDecisionResponse {
  message: string
  status: 'APPLIED' | 'CANCELLED'
}
