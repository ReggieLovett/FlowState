import 'server-only'

import { Prisma, type AssistantProposal as StoredProposal } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { readGoogleCalendar } from './google-calendar'
import type { AssistantDecisionResponse, AssistantResponse } from './contracts'
import { readLocalContext, type LocalContext } from './context'
import { AssistantError } from './errors'
import { generatePlan, requireGroqKey } from './groq'
import { validateOperations, validateCombinedTimeline, type FullEventSnapshot } from './operations'
import {
  applyOperations, describeDeletionImpact, lockOperationRows, mutationSnapshotSchema, readOperationContext,
  storedMutationPlanSchema, verifyOperationSnapshot,
} from './mutation-persistence'
import {
  PlanValidationError,
  PROPOSAL_LIFETIME_MS,
  WINDOW_DAYS,
  MAX_MOVES,
  resolvedDecision,
  storedChangesSchema,
  storedSnapshotSchema,
  validateMoves,
  validateSnapshots,
  type BusyInterval,
  type PlanningWindow,
} from './validation'

interface GoogleContext { connected: boolean; events: BusyInterval[]; warning?: string }

/** Any unavailable or incomplete connected calendar makes schedule actions fail closed. */
async function readCalendarSafely(userId: string, window: PlanningWindow): Promise<GoogleContext> {
  try {
    const calendar = await readGoogleCalendar(userId, window.start, window.end)
    if (calendar.events.length > 500 || calendar.events.some((event) => {
      const start = Date.parse(event.startsAt)
      const end = Date.parse(event.endsAt)
      return !Number.isFinite(start) || !Number.isFinite(end) || end <= start
    })) {
      return { connected: true, events: [], warning: 'Google Calendar returned incomplete busy times. Try again before changing your timeline.' }
    }
    return calendar.warning ? { ...calendar, events: [] } : calendar
  } catch {
    return { connected: true, events: [], warning: 'Google Calendar could not be fully checked. Try again before changing your timeline.' }
  }
}

function actionBlockers(local: LocalContext, google: GoogleContext) {
  const blockers: string[] = []
  if (local.eventsTruncated) blockers.push('There are too many events to safely check the complete timeline. I can give advice, but cannot propose calendar changes in this context.')
  if (local.hasUnexpandedRecurrence) blockers.push('FlowState recurring events cannot yet be expanded into all occurrences. Calendar time changes are paused to avoid hidden conflicts.')
  if (google.warning) blockers.push(google.warning)
  return blockers
}

export async function askAssistant(userId: string, prompt: string, timeZone: string, history: Array<{ role: 'user' | 'assistant'; content: string }> = []): Promise<AssistantResponse> {
  // Fail before calendar/database work when the provider has not been configured.
  requireGroqKey()
  const start = new Date()
  const window = { start, end: new Date(start.getTime() + WINDOW_DAYS * 24 * 60 * 60_000) }
  const [local, google] = await Promise.all([readLocalContext(userId, window), readCalendarSafely(userId, window)])
  const blockers = actionBlockers(local, google)
  const plan = await generatePlan({ prompt, timeZone, window, local, google, actionBlockers: blockers, history })
  const calendar = { connected: google.connected, ...(google.warning ? { warning: google.warning } : {}) }
  const operations = plan.operations ?? []
  if (plan.changes.length + operations.length > MAX_MOVES) throw new AssistantError('This plan contains too many changes. Use at most 12 changes at a time.', 422)
  let domain: Awaited<ReturnType<typeof readOperationContext>> | null = null
  let validatedOperations: ReturnType<typeof validateOperations> | null = null
  try {
    if (operations.length) {
      domain = await readOperationContext(userId, operations)
      validatedOperations = validateOperations(operations, domain.context, window, new Date(), timeZone)
    }
  } catch (error) {
    if (error instanceof PlanValidationError) throw new AssistantError(error.message, 422)
    throw error
  }
  if (blockers.length > 0 && (plan.changes.length > 0 || validatedOperations?.touchesTimeline)) {
    // Enforce action restrictions regardless of the model's obedience. Include
    // server-owned explanations so the assistant cannot hide missing context.
    return { message: `${plan.message}\n\n${blockers.join(' ')}`, calendar }
  }
  if (plan.changes.length === 0 && operations.length === 0) return { message: plan.message, calendar }

  let changes
  try {
    changes = validateMoves(plan.changes, local.events, google.events, window, new Date(), !domain)
    if (domain && (changes.length || validatedOperations?.touchesTimeline)) {
      validateCombinedTimeline(changes, operations, mergeEvents(local.fullEvents, domain.context.events), google.events, window, new Date(), timeZone)
    }
  } catch (error) {
    if (error instanceof PlanValidationError) throw new AssistantError(error.message, 422)
    throw error
  }
  const movedIds = new Set(changes.map((change) => change.eventId))
  const stored = await prisma.assistantProposal.create({
    data: {
      userId,
      message: plan.message,
      changes: domain ? { version: 2, changes: changes.map((change) => ({ ...change })), operations: operations.map((operation) => ({ ...operation })) } : changes.map((change) => ({ ...change })),
      snapshot: domain ? {
        version: 2, calendarConnected: google.connected,
        moveEvents: local.events.filter((event) => movedIds.has(event.id)).map((event) => ({ ...event })),
        ...domain.snapshot,
      } : {
        version: 1,
        calendarConnected: google.connected,
        events: local.events.filter((event) => movedIds.has(event.id)).map((event) => ({ ...event })),
      },
      timeZone,
      windowStart: window.start,
      windowEnd: window.end,
      expiresAt: new Date(Date.now() + PROPOSAL_LIFETIME_MS),
    },
    select: { id: true, expiresAt: true },
  })

  return {
    message: plan.message,
    proposal: {
      id: stored.id, expiresAt: stored.expiresAt.toISOString(), changes,
      ...(domain && validatedOperations ? { operations: validatedOperations.previews.map((preview, index) => ({
        ...preview, details: [...preview.details, ...describeDeletionImpact(domain.snapshot, operations[index])],
      })) } : {}),
    },
    calendar,
  }
}

function mergeEvents(local: FullEventSnapshot[], referenced: FullEventSnapshot[]) {
  return [...new Map([...local, ...referenced].map((event) => [event.id, event])).values()]
}

function decisionResult(status: 'APPLIED' | 'CANCELLED'): AssistantDecisionResponse {
  return {
    status,
    message: status === 'APPLIED' ? 'Your approved changes are saved in FlowState.' : 'Plan cancelled. Your schedule is unchanged.',
  }
}

function checkDecision(proposal: StoredProposal, action: 'confirm' | 'cancel') {
  try { return resolvedDecision(proposal.status, action, proposal.expiresAt) } catch (error) {
    if (error instanceof PlanValidationError) throw new AssistantError(error.message, 409)
    throw error
  }
}

function readMutationPlan(proposal: StoredProposal) {
  const plan = storedMutationPlanSchema.safeParse(proposal.changes)
  const snapshot = mutationSnapshotSchema.safeParse(proposal.snapshot)
  if (!plan.success || !snapshot.success || plan.data.changes.length + plan.data.operations.length > MAX_MOVES) {
    throw new AssistantError('This proposal cannot be verified. Cancel it and ask for a new plan.', 409)
  }
  return { plan: plan.data, snapshot: snapshot.data }
}

function isMutationPlan(proposal: StoredProposal) {
  return typeof proposal.changes === 'object' && proposal.changes !== null && !Array.isArray(proposal.changes)
}

function needsCalendar(proposal: StoredProposal) {
  if (!isMutationPlan(proposal)) return true
  const { plan, snapshot } = readMutationPlan(proposal)
  try {
    return plan.changes.length > 0 || validateOperations(plan.operations, snapshot, {
      start: proposal.windowStart, end: proposal.windowEnd,
    }, new Date(), proposal.timeZone).touchesTimeline
  } catch (error) {
    if (error instanceof PlanValidationError) throw new AssistantError(error.message, 409)
    throw error
  }
}

async function applyMutationPlan(userId: string, proposal: StoredProposal, google: GoogleContext | null, tx: Prisma.TransactionClient) {
  const { plan, snapshot } = readMutationPlan(proposal)
  const window = { start: proposal.windowStart, end: proposal.windowEnd }
  await lockOperationRows(userId, snapshot, tx)
  const domain = await readOperationContext(userId, plan.operations, tx)
  verifyOperationSnapshot(snapshot, domain.snapshot)
  try {
    const validated = validateOperations(plan.operations, domain.context, window, new Date(), proposal.timeZone)
    if (plan.changes.length || validated.touchesTimeline) {
      if (!google || google.warning || (snapshot.calendarConnected && !google.connected)) {
        throw new AssistantError(google?.warning ?? 'Reconnect Google Calendar before confirming this plan.', 409)
      }
      const local = await readLocalContext(userId, window, tx)
      const blockers = actionBlockers(local, google)
      if (blockers.length) throw new AssistantError(blockers.join(' '), 409)
      validateSnapshots(snapshot.moveEvents, local.events)
      const moves = validateMoves(plan.changes.map((change) => ({
        eventId: change.eventId, toStart: change.toStart, toEnd: change.toEnd, reason: change.reason,
      })), local.events, google.events, window, new Date(), false)
      if (JSON.stringify(moves) !== JSON.stringify(plan.changes)) throw new PlanValidationError('The reviewed moves no longer match your schedule. Ask for a fresh plan.')
      validateCombinedTimeline(moves, plan.operations, mergeEvents(local.fullEvents, domain.context.events), google.events, window, new Date(), proposal.timeZone)
    }
  } catch (error) {
    if (error instanceof PlanValidationError) throw new AssistantError(error.message, 409)
    throw error
  }
  // The model never supplies an owner or a persistent id for new rows.
  // All writes below and APPLIED commit together, or all roll back together.
  await applyOperations(userId, plan.operations, tx, domain.context)
  for (const change of plan.changes) {
    const source = snapshot.moveEvents.find((event) => event.id === change.eventId)
    if (!source) throw new AssistantError('This proposal cannot be verified. Ask for a new plan.', 409)
    const result = await tx.scheduleEvent.updateMany({
      where: { id: change.eventId, userId, status: 'SCHEDULED', isAllDay: false, recurrenceRule: null,
        updatedAt: new Date(source.updatedAt), startsAt: new Date(source.startsAt), endsAt: new Date(source.endsAt) },
      data: { startsAt: new Date(change.toStart), endsAt: new Date(change.toEnd), planReason: null },
    })
    if (result.count !== 1) throw new AssistantError('Your schedule changed. Ask for a fresh plan.', 409)
  }
}

/** No client-supplied event ids or times enter this mutation path. */
export async function decideProposal(userId: string, id: string, action: 'confirm' | 'cancel'): Promise<AssistantDecisionResponse> {
  const initial = await prisma.assistantProposal.findUnique({ where: { id_userId: { id, userId } } })
  if (!initial) throw new AssistantError('Proposal not found.', 404)
  const resolved = checkDecision(initial, action)
  if (resolved) return decisionResult(resolved)

  // Recheck Google immediately before the database transaction. Google is an
  // external read-only source and cannot participate in a PostgreSQL commit.
  const window = { start: initial.windowStart, end: initial.windowEnd }
  const google = action === 'confirm' && needsCalendar(initial) ? await readCalendarSafely(userId, window) : null

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        // Serialize duplicate decisions for this owner's proposal. A second
        // confirm sees APPLIED and succeeds without moving anything twice.
        const locked = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT "id" FROM "AssistantProposal"
          WHERE "id" = ${id} AND "userId" = ${userId}
          FOR UPDATE
        `
        if (locked.length === 0) throw new AssistantError('Proposal not found.', 404)
        const proposal = await tx.assistantProposal.findUnique({ where: { id_userId: { id, userId } } })
        if (!proposal) throw new AssistantError('Proposal not found.', 404)
        const alreadyResolved = checkDecision(proposal, action)
        if (alreadyResolved) return decisionResult(alreadyResolved)

        if (action === 'cancel') {
          await tx.assistantProposal.update({ where: { id_userId: { id, userId } }, data: { status: 'CANCELLED' } })
          return decisionResult('CANCELLED')
        }

        if (isMutationPlan(proposal)) {
          await applyMutationPlan(userId, proposal, google, tx)
          await tx.assistantProposal.update({ where: { id_userId: { id, userId } }, data: { status: 'APPLIED', appliedAt: new Date() } })
          return decisionResult('APPLIED')
        }

        const changesResult = storedChangesSchema.safeParse(proposal.changes)
        const snapshotResult = storedSnapshotSchema.safeParse(proposal.snapshot)
        if (!changesResult.success || !snapshotResult.success) throw new AssistantError('This proposal cannot be verified. Cancel it and ask for a new plan.', 409)
        const changes = changesResult.data
        const snapshot = snapshotResult.data
        if (!google || google.warning || (snapshot.calendarConnected && !google.connected)) {
          throw new AssistantError(google?.warning ?? 'Reconnect Google Calendar before confirming this plan.', 409)
        }

        const local = await readLocalContext(userId, window, tx)
        const blockers = actionBlockers(local, google)
        if (blockers.length) throw new AssistantError(blockers.join(' '), 409)

        try {
          // Deletion, completion, edit or loss of ownership all invalidate the
          // reviewed source snapshots. Then recheck the final timeline against
          // every fresh local event and the fresh Google Calendar intervals.
          validateSnapshots(snapshot.events, local.events)
          const validated = validateMoves(changes.map((change) => ({
            eventId: change.eventId,
            toStart: change.toStart,
            toEnd: change.toEnd,
            reason: change.reason,
          })), local.events, google.events, window)
          if (JSON.stringify(validated) !== JSON.stringify(changes)) {
            throw new PlanValidationError('The reviewed plan no longer matches your schedule. Ask for a new plan.')
          }
        } catch (error) {
          if (error instanceof PlanValidationError) throw new AssistantError(error.message, 409)
          throw error
        }

        for (const change of changes) {
          const source = snapshot.events.find((event) => event.id === change.eventId)
          if (!source) throw new AssistantError('This proposal cannot be verified. Ask for a new plan.', 409)
          // Guard each write as well as the prior read. A stale source cannot
          // be silently overwritten by another edit during confirmation.
          const result = await tx.scheduleEvent.updateMany({
            where: {
              id: change.eventId,
              userId,
              status: 'SCHEDULED',
              isAllDay: false,
              recurrenceRule: null,
              updatedAt: new Date(source.updatedAt),
              startsAt: new Date(source.startsAt),
              endsAt: new Date(source.endsAt),
            },
            data: { startsAt: new Date(change.toStart), endsAt: new Date(change.toEnd), planReason: null },
          })
          if (result.count !== 1) throw new AssistantError('Your schedule changed. Ask for a fresh plan.', 409)
        }

        await tx.assistantProposal.update({
          where: { id_userId: { id, userId } },
          data: { status: 'APPLIED', appliedAt: new Date() },
        })
        return decisionResult('APPLIED')
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5000, timeout: 10_000 })
    } catch (error) {
      // Serializable conflicts include a concurrent duplicate confirm. Retry
      // the whole transaction so it can observe that already-applied decision.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
        if (attempt < 2) continue
        throw new AssistantError('Your schedule is being edited elsewhere. Try confirming again.', 409)
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new AssistantError('A class with that name already exists. Ask for a fresh plan using a different name.', 409)
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === 'P2025' || error.code === 'P2003')) {
        throw new AssistantError('A linked class, work item, or event changed. Ask for a fresh plan.', 409)
      }
      throw error
    }
  }
  throw new AssistantError('The proposal could not be applied. Try again.', 409)
}
