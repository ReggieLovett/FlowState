import type { Category } from '@prisma/client'

/**
 * Display metadata for the commitment types.
 *
 * The audience is college students and working professionals, so the vocabulary
 * is lectures, seminars, labs, client meetings, deadlines and focus blocks. The
 * enum is the source of truth in the database; this map is only presentation.
 */
export const CATEGORY_META: Record<
  Category,
  { label: string; plural: string; description: string; colorHex: string }
> = {
  LECTURE: {
    label: 'Lecture',
    plural: 'Lectures',
    description: 'Scheduled teaching, usually recurring weekly',
    colorHex: '#4C6EF5',
  },
  SEMINAR: {
    label: 'Seminar',
    plural: 'Seminars',
    description: 'Small-group discussion or tutorial',
    colorHex: '#7950F2',
  },
  LAB_SESSION: {
    label: 'Lab Session',
    plural: 'Lab Sessions',
    description: 'Practical or studio work with fixed equipment time',
    colorHex: '#0CA678',
  },
  CLIENT_MEETING: {
    label: 'Client Meeting',
    plural: 'Client Meetings',
    description: 'External call or on-site meeting',
    colorHex: '#F76707',
  },
  PROJECT_DEADLINE: {
    label: 'Project Deadline',
    plural: 'Project Deadlines',
    description: 'A dated hand-off or submission',
    colorHex: '#E03131',
  },
  DEEP_WORK_SHIFT: {
    label: 'Deep Work Shift',
    plural: 'Deep Work Shifts',
    description: 'Protected, uninterrupted focus time',
    colorHex: '#1098AD',
  },
  OTHER: {
    label: 'Other',
    plural: 'Other',
    description: 'Anything that does not fit the categories above',
    colorHex: '#868E96',
  },
}

/** Stable order for pickers and legends. */
export const CATEGORY_ORDER: Category[] = [
  'LECTURE',
  'SEMINAR',
  'LAB_SESSION',
  'CLIENT_MEETING',
  'PROJECT_DEADLINE',
  'DEEP_WORK_SHIFT',
  'OTHER',
]
