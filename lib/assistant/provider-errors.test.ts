import assert from 'node:assert/strict'
import { test } from 'node:test'
import { AssistantError } from './errors'
import { groqFailureError, logGroqFailure, readGroqFailure, type GroqFailureKind } from './provider-errors'

const upstream = (error: unknown, status = 400) => Response.json({ error }, { status })

test('recognized structured-output failures permit format recovery on 400 and 422 only', async () => {
  for (const status of [400, 422]) {
    for (const error of [
      { code: 'json_validate_failed' }, { code: 'schema_validation_failed' }, { code: 'invalid_json_schema' },
      { param: 'response_format' }, { param: 'response_format.json_schema.schema' }, { param: 'json_schema' },
      { message: 'This response_format is not supported.' }, { message: 'The JSON schema grammar is invalid.' },
      { message: 'Structured outputs could not be generated.' }, { message: 'Failed to generate JSON. Please adjust your prompt.' },
      { message: 'JSON validation failed.' },
      { message: 'Generated JSON does not match the expected schema. Please adjust your prompt.' },
    ]) {
      assert.deepEqual(await readGroqFailure(upstream(error, status), 'json_schema'), { kind: 'format', status })
    }
  }
  assert.equal((await readGroqFailure(upstream({ code: 'json_validate_failed' }), 'json_object')).kind, 'format')
  assert.equal((await readGroqFailure(upstream({ code: 'json_validate_failed' }, 409), 'json_schema')).kind, 'request')
})

test('HTTP statuses classify auth, access, rate, model, size, billing and availability without trusting a format message', async () => {
  const cases: Array<[number, GroqFailureKind]> = [[401, 'auth'], [403, 'access'], [429, 'rate_limit'], [404, 'model'], [413, 'context'], [402, 'billing'], [500, 'unavailable'], [503, 'unavailable']]
  for (const [status, kind] of cases) {
    assert.deepEqual(await readGroqFailure(upstream({ code: 'json_validate_failed', message: 'response_format rejected' }, status), 'json_schema'), { kind, status })
  }
})

test('specific structured failures override schema-related wording and parameters', async () => {
  const cases: Array<[Record<string, string>, GroqFailureKind]> = [
    [{ code: 'context_length_exceeded' }, 'context'], [{ type: 'context_window_exceeded' }, 'context'],
    [{ code: 'payload_too_large' }, 'context'], [{ param: 'max_completion_tokens' }, 'context'],
    [{ code: 'model_not_found' }, 'model'], [{ param: 'model' }, 'model'],
    [{ code: 'insufficient_quota' }, 'billing'], [{ code: 'invalid_api_key' }, 'auth'],
    [{ code: 'permission_denied' }, 'access'], [{ code: 'rate_limit_exceeded' }, 'rate_limit'],
  ]
  for (const [fields, kind] of cases) {
    assert.equal((await readGroqFailure(upstream({ message: 'response_format rejected', ...fields }), 'json_schema')).kind, kind)
  }
  for (const message of [
    'The context length exceeds the limit for response_format.',
    'Request too large with structured outputs.',
    'Maximum token limit exceeded for JSON schema.',
  ]) assert.equal((await readGroqFailure(upstream({ message }), 'json_schema')).kind, 'context')
  for (const [message, kind] of [
    ['Invalid API key for response_format.', 'auth'],
    ['Permission denied for JSON schema.', 'access'],
    ['Rate limit exceeded for structured outputs.', 'rate_limit'],
    ['Credit balance is too low for response_format.', 'billing'],
  ]) assert.equal((await readGroqFailure(upstream({ message }), 'json_schema')).kind, kind)
})

test('unknown or malformed request failures never trigger format recovery', async () => {
  for (const response of [
    upstream({ message: 'Bad request.' }), upstream({}), upstream({ message: 'JSON is a data format.' }),
    Response.json({ message: 'response_format rejected' }, { status: 400 }),
    new Response('not JSON; response_format rejected', { status: 400 }),
    upstream({ message: ['response_format'] }), upstream(null),
  ]) assert.deepEqual(await readGroqFailure(response, 'json_schema'), { kind: 'request', status: 400 })
})

test('upstream error reading is bounded and cancellation failures stay private', async () => {
  let cancelled = false
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(JSON.stringify({ error: { code: 'json_validate_failed', failed_generation: 'private'.repeat(7000) } })))
    },
    cancel() { cancelled = true; throw new Error('private cancellation detail') },
  })
  assert.deepEqual(await readGroqFailure(new Response(stream, { status: 400 }), 'json_schema'), { kind: 'request', status: 400 })
  assert.equal(cancelled, true)
  const broken = new ReadableStream<Uint8Array>({ start(controller) { controller.error(new Error('private streaming detail')) } })
  assert.deepEqual(await readGroqFailure(new Response(broken, { status: 400 }), 'json_schema'), { kind: 'request', status: 400 })
})

test('public errors and structured logs contain no upstream prompt, secret or failed generation', async (t) => {
  const secret = 'sk-private-key-user-calendar-title'
  const failure = await readGroqFailure(upstream({ code: 'json_validate_failed', message: `Failed to generate JSON. ${secret}`, failed_generation: secret }), 'json_schema')
  const error = groqFailureError(failure)
  assert.ok(error instanceof AssistantError)
  assert.equal(error.status, 502)
  assert.match(error.message, /Groq HTTP 400/)
  assert.doesNotMatch(error.message, /sk-private|calendar-title|failed_generation/)
  const logs: unknown[] = []
  t.mock.method(console, 'warn', (...args: unknown[]) => { logs.push(args) })
  logGroqFailure(failure, 'json_schema')
  assert.deepEqual(logs, [[{ model: 'openai/gpt-oss-120b', status: 400, kind: 'format', format: 'json_schema' }]])
  assert.equal(JSON.stringify(logs).includes(secret), false)
  assert.deepEqual(Object.keys(failure).sort(), ['kind', 'status'])
})

test('all failure types give fixed actionable messages with the upstream HTTP status', () => {
  const kinds: GroqFailureKind[] = ['format', 'auth', 'access', 'rate_limit', 'context', 'model', 'billing', 'request', 'unavailable']
  for (const kind of kinds) {
    const error = groqFailureError({ kind, status: 422 })
    assert.ok(error instanceof AssistantError)
    assert.match(error.message, /Groq HTTP 422/)
    assert.match(error.message, /Try|Check|Ask|Wait|check/)
  }
})
