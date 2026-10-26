import assert from 'node:assert/strict'
import { after, beforeEach, test, type TestContext } from 'node:test'
import { generatePlan, GROQ_MODEL } from './groq'
import { AssistantError } from './errors'
import type { LocalContext } from './context'
import type { AssistantOperation } from './operations'
import type { ModelPlan } from './validation'

const originalKey = process.env.GROQ_API_KEY
beforeEach(() => { process.env.GROQ_API_KEY = 'test-only-provider-key' })
after(() => {
  if (originalKey === undefined) delete process.env.GROQ_API_KEY
  else process.env.GROQ_API_KEY = originalKey
})

const emptyLocal = (): LocalContext => ({
  events: [], fullEvents: [], subjects: [], items: [],
  eventsTruncated: false, subjectsTruncated: false, itemsTruncated: false,
  truncated: false, hasUnexpandedRecurrence: false,
})
const input = () => {
  const start = new Date()
  return {
    prompt: 'Create a focus session tomorrow at 9 AM for one hour.',
    timeZone: 'Asia/Manila',
    window: { start, end: new Date(start.getTime() + 14 * 86_400_000) },
    local: emptyLocal(), google: { connected: false, events: [] }, actionBlockers: [] as string[],
  }
}
const event = (): AssistantOperation => {
  const startsAt = new Date(Date.now() + 24 * 3_600_000)
  return {
    kind: 'event.create', subjectId: null, itemId: null, title: 'Focus session', category: 'DEEP_WORK_SHIFT',
    startsAt: startsAt.toISOString(), endsAt: new Date(startsAt.getTime() + 3_600_000).toISOString(),
    isAllDay: false, location: null, notes: null, reason: 'Add the requested session.',
  }
}
const plan = (message: string, operations: AssistantOperation[] = []): ModelPlan => ({ message, changes: [], operations })
const oldRefusal = 'I’m sorry, I can’t create new events. With no existing events in the provided window, there’s nothing to move. If you add events, I can suggest rescheduling them within the next 14 days.'
const reply = (value: ModelPlan) => Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }] })

interface ProviderRequest {
  model: string
  messages: Array<{ role: string; content: string }>
  response_format: {
    type: string
    json_schema?: { strict: boolean; schema: { required: string[]; properties: { operations: unknown } } }
  }
}
function provider(t: TestContext, replies: Response[]) {
  const calls: Array<{ body: ProviderRequest; signal: RequestInit['signal'] }> = []
  t.mock.method(console, 'warn', () => {})
  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request, init?: RequestInit) => {
    assert.equal(String(url), 'https://api.groq.com/openai/v1/chat/completions')
    assert.equal(init?.method, 'POST')
    assert.equal(init?.cache, 'no-store')
    calls.push({ body: JSON.parse(String(init?.body)) as ProviderRequest, signal: init?.signal })
    const response = replies.shift()
    assert.ok(response, 'The provider must not be retried beyond the bounded response queue.')
    return response
  })
  return calls
}

test('an empty calendar sends full creation capabilities and accepts a new event proposal', async (t) => {
  const operation = event()
  const calls = provider(t, [reply(plan('Review this new session, then Confirm to save.', [operation]))])
  const result = await generatePlan(input())
  assert.deepEqual(result.operations, [operation])
  assert.equal(calls.length, 1)
  const request = calls[0].body
  assert.equal(request.model, GROQ_MODEL)
  assert.equal(request.response_format.type, 'json_schema')
  assert.ok(request.response_format.json_schema)
  assert.equal(request.response_format.json_schema.strict, true)
  assert.ok(request.response_format.json_schema.schema.required.includes('operations'))
  assert.match(JSON.stringify(request.response_format.json_schema.schema.properties.operations), /event\.create/)
  const system = request.messages.find(message => message.role === 'system')!.content
  assert.match(system, /empty/i)
  assert.match(system, /event\.create/)
  assert.match(system, /confirm/i)
  assert.doesNotMatch(system, /NO write tools/)
  const context = JSON.parse(request.messages.at(-1)!.content) as { local: { events: unknown[] } }
  assert.deepEqual(context.local.events, [])
})

test('old assistant capability refusals remain untrusted history under the current creation rules', async (t) => {
  const calls = provider(t, [reply(plan('Review the proposed session.', [event()]))])
  await generatePlan({ ...input(), history: [{ role: 'user', content: 'Can you create events?' }, { role: 'assistant', content: oldRefusal }] })
  const messages = calls[0].body.messages
  const system = messages.find(message => message.role === 'system')!.content
  assert.match(system, /history.*untrusted|untrusted.*history/i)
  assert.match(system, /(?:old|previous|earlier|outdated).*(?:capabilit|refus|create)|(?:capabilit|refus).*(?:old|previous|earlier|outdated)/i)
  assert.ok(messages.some(message => message.role === 'assistant' && message.content === oldRefusal))
  assert.equal(messages.at(-1)!.role, 'user')
})

test('the reported false incapability gets one corrective retry and returns the event proposal', async (t) => {
  const operation = event()
  const calls = provider(t, [reply(plan(oldRefusal)), reply(plan('Review this session before saving.', [operation]))])
  const result = await generatePlan(input())
  assert.deepEqual(result.operations, [operation])
  assert.equal(calls.length, 2)
  assert.ok(calls[0].signal)
  assert.equal(calls[1].signal, calls[0].signal, 'The correction must share the original timeout budget.')
  const correction = calls[1].body.messages.filter(message => message.role === 'system').map(message => message.content).join('\n')
  assert.match(correction, /event\.create/)
  assert.match(correction, /confirm/i)
})

test('repeated false incapability stops after one correction and reports an actionable provider failure', async (t) => {
  const calls = provider(t, [reply(plan(oldRefusal)), reply(plan(oldRefusal))])
  await assert.rejects(generatePlan(input()), (error: unknown) => error instanceof AssistantError && error.status === 502 && /try|retry|create|support|proposal/i.test(error.message))
  assert.equal(calls.length, 2)
})

test('missing dates or duration are a clarification rather than a reason to retry', async (t) => {
  const clarification = plan('What date, start time, and duration should the new event have?')
  const calls = provider(t, [reply(clarification)])
  assert.deepEqual(await generatePlan({ ...input(), prompt: 'Create a meeting.' }), clarification)
  assert.equal(calls.length, 1)
})

test('actual calendar blockers do not trigger corrective generation', async (t) => {
  const blocked = plan(oldRefusal)
  const calls = provider(t, [reply(blocked)])
  assert.deepEqual(await generatePlan({ ...input(), actionBlockers: ['Google Calendar could not be fully checked.'] }), blocked)
  assert.equal(calls.length, 1)
})

test('a Google Calendar write denial is preserved without retry', async (t) => {
  const denial = plan('I can’t create new events in Google Calendar. I can propose events in FlowState for confirmation.')
  const calls = provider(t, [reply(denial)])
  assert.deepEqual(await generatePlan({ ...input(), prompt: 'Create the appointment in Google Calendar.' }), denial)
  assert.equal(calls.length, 1)
})

test('a provider refusal never triggers a capability correction', async (t) => {
  const calls = provider(t, [Response.json({ choices: [{ finish_reason: 'stop', message: { content: null, refusal: 'I cannot assist with that request.' } }] })])
  await assert.rejects(generatePlan(input()), (error: unknown) => error instanceof AssistantError && error.status === 422)
  assert.equal(calls.length, 1)
})

test('the correction uses the remaining timeout budget and aborts without a third request', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let releaseFirst!: (response: Response) => void
  let secondStarted!: () => void
  const started = new Promise<void>(resolve => { secondStarted = resolve })
  const signals: AbortSignal[] = []
  t.mock.method(globalThis, 'fetch', (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    assert.ok(init?.signal)
    signals.push(init.signal)
    if (signals.length === 1) return new Promise<Response>(resolve => { releaseFirst = resolve })
    assert.equal(signals.length, 2, 'Only one corrective request is permitted.')
    secondStarted()
    return new Promise<Response>((_resolve, reject) => {
      init.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
    })
  })
  const pending = generatePlan(input())
  t.mock.timers.tick(15_000)
  releaseFirst(reply(plan(oldRefusal)))
  // If correction is missing, report that result rather than hanging this test.
  const next = await Promise.race([started.then(() => 'retry'), pending.then(() => 'completed')])
  assert.equal(next, 'retry')
  assert.equal(signals[1], signals[0])
  t.mock.timers.tick(9_999)
  assert.equal(signals[1].aborted, false)
  t.mock.timers.tick(1)
  await assert.rejects(pending, (error: unknown) => error instanceof AssistantError && error.status === 504)
  assert.equal(signals.length, 2)
})

const schemaRejection = () => Response.json({
  error: { type: 'invalid_request_error', param: 'response_format', message: 'schema grammar unsupported' },
}, { status: 400 })
const rawReply = (value: unknown) => Response.json({
  choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }],
})

test('a strict schema rejection retries once with JSON object mode and the complete approval-aware schema', async (t) => {
  const operation = event()
  const calls = provider(t, [schemaRejection(), reply(plan('Review and Confirm to add this session.', [operation]))])

  const result = await generatePlan(input())

  assert.deepEqual(result.operations, [operation])
  assert.equal(calls.length, 2)
  assert.equal(calls[0].body.response_format.type, 'json_schema')
  assert.equal(calls[1].body.response_format.type, 'json_object')
  assert.equal(calls[1].body.response_format.json_schema, undefined)
  assert.ok(calls[0].signal)
  assert.equal(calls[1].signal, calls[0].signal)
  const strictSchema = calls[0].body.response_format.json_schema!.schema
  const fallbackInstructions = calls[1].body.messages.filter(message => message.role === 'system').map(message => message.content).join('\n')
  assert.ok(fallbackInstructions.includes(JSON.stringify(strictSchema)), 'JSON mode must receive the complete output contract, including all operation variants.')
  assert.match(fallbackInstructions, /json/i)
  assert.match(fallbackInstructions, /only after the user clicks Confirm/i)
  assert.match(fallbackInstructions, /never.*already.*saved/i)
})

for (const invalid of [
  { name: 'an incomplete plan', value: () => ({ message: 'Save this session.', operations: [event()] }) },
  { name: 'a plan without explicit operations', value: () => ({ message: 'Review this plan.', changes: [] }) },
  { name: 'an operation with an injected owner', value: () => ({ ...plan('Review the session.'), operations: [{ ...event(), userId: 'another-user' }] }) },
]) {
  test(`JSON object fallback rejects ${invalid.name} without a third request`, async (t) => {
    const calls = provider(t, [schemaRejection(), rawReply(invalid.value())])

    await assert.rejects(generatePlan(input()), (error: unknown) => error instanceof AssistantError && error.status === 502 && /invalid plan/i.test(error.message))

    assert.equal(calls.length, 2)
    assert.equal(calls[1].body.response_format.type, 'json_object')
  })
}

for (const failure of [
  { status: 400, error: { type: 'invalid_request_error', param: 'messages', message: 'Invalid messages supplied.' } },
  { status: 401, error: { type: 'invalid_api_key', message: 'Invalid credentials.' } },
  { status: 403, error: { type: 'permission_error', message: 'Access is denied.' } },
  { status: 413, error: { type: 'request_too_large', message: 'Request body is too large.' } },
  { status: 422, error: { type: 'invalid_request_error', message: 'Unable to process input.' } },
  { status: 429, error: { type: 'rate_limit_exceeded', message: 'Rate limit reached.' } },
  { status: 500, error: { type: 'server_error', message: 'Internal provider failure.' } },
  { status: 503, error: { type: 'server_error', message: 'Service unavailable.' } },
]) {
  test(`an unrelated provider HTTP ${failure.status} failure has an actionable status and does not retry`, async (t) => {
    const calls = provider(t, [Response.json({ error: failure.error }, { status: failure.status })])

    await assert.rejects(generatePlan(input()), (error: unknown) => {
      assert.ok(error instanceof AssistantError)
      assert.match(error.message, new RegExp(`HTTP ${failure.status}\\b`, 'i'))
      return true
    })

    assert.equal(calls.length, 1)
  })
}

test('a schema fallback and then a capability correction use at most three calls under the same signal', async (t) => {
  const operation = event()
  const calls = provider(t, [schemaRejection(), reply(plan(oldRefusal)), reply(plan('Review this session.', [operation]))])

  assert.deepEqual((await generatePlan(input())).operations, [operation])

  assert.equal(calls.length, 3)
  assert.deepEqual(calls.map(call => call.body.response_format.type), ['json_schema', 'json_object', 'json_object'])
  assert.ok(calls[0].signal)
  assert.ok(calls.every(call => call.signal === calls[0].signal))
  const finalSystem = calls[2].body.messages.filter(message => message.role === 'system').map(message => message.content).join('\n')
  assert.match(finalSystem, /previous empty plan incorrectly denied/i)
  assert.match(finalSystem, /only after the user clicks Confirm/i)
})

test('a capability correction and then a schema fallback use at most three calls under the same signal', async (t) => {
  const operation = event()
  const calls = provider(t, [reply(plan(oldRefusal)), schemaRejection(), reply(plan('Review this session.', [operation]))])

  assert.deepEqual((await generatePlan(input())).operations, [operation])

  assert.equal(calls.length, 3)
  assert.deepEqual(calls.map(call => call.body.response_format.type), ['json_schema', 'json_schema', 'json_object'])
  assert.ok(calls[0].signal)
  assert.ok(calls.every(call => call.signal === calls[0].signal))
  const finalSystem = calls[2].body.messages.filter(message => message.role === 'system').map(message => message.content).join('\n')
  assert.match(finalSystem, /previous empty plan incorrectly denied/i)
  assert.match(finalSystem, /only after the user clicks Confirm/i)
})

test('format fallback and capability correction share the original 25-second timeout rather than restarting it', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  t.mock.method(console, 'warn', () => {})
  const release: Array<(response: Response) => void> = []
  const signals: AbortSignal[] = []
  let secondStarted!: () => void
  let thirdStarted!: () => void
  const second = new Promise<void>(resolve => { secondStarted = resolve })
  const third = new Promise<void>(resolve => { thirdStarted = resolve })
  t.mock.method(globalThis, 'fetch', (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    assert.ok(init?.signal)
    signals.push(init.signal)
    assert.ok(signals.length <= 3, 'Combined corrections must never produce a fourth provider request.')
    if (signals.length === 2) secondStarted()
    if (signals.length < 3) return new Promise<Response>(resolve => { release.push(resolve) })
    thirdStarted()
    return new Promise<Response>((_resolve, reject) => {
      init.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
    })
  })

  const pending = generatePlan(input())
  t.mock.timers.tick(10_000)
  release[0](schemaRejection())
  assert.equal(await Promise.race([second.then(() => 'retry'), pending.then(() => 'completed')]), 'retry')
  t.mock.timers.tick(10_000)
  release[1](reply(plan(oldRefusal)))
  assert.equal(await Promise.race([third.then(() => 'retry'), pending.then(() => 'completed')]), 'retry')
  assert.ok(signals.every(signal => signal === signals[0]))
  t.mock.timers.tick(4_999)
  assert.equal(signals[2].aborted, false)
  t.mock.timers.tick(1)

  await assert.rejects(pending, (error: unknown) => error instanceof AssistantError && error.status === 504)
  assert.equal(signals.length, 3)
})
