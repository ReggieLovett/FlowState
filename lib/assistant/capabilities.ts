/** Public, non-sensitive build marker for diagnosing stale deployments. */
export const ASSISTANT_VERSION = 'flowstate-crud-v2.1'

export const assistantCapabilities = {
  version: ASSISTANT_VERSION,
  canCreateClasses: true,
  canCreateWorkItems: true,
  canCreateEvents: true,
  requiresConfirmation: true,
  calendarWrites: 'FlowState only',
} as const
