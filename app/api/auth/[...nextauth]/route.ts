import { handlers } from '@/auth'

/**
 * Auth.js route handler.
 *
 * v5 exposes both verbs on a single `handlers` object; this file exists only to
 * mount them at /api/auth/*.
 */
export const { GET, POST } = handlers
