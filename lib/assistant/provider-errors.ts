import 'server-only'

import { AssistantError } from './errors'

export type GroqResponseFormat = 'json_schema' | 'json_object'
export type GroqFailureKind = 'format' | 'auth' | 'access' | 'rate_limit' | 'context' | 'model' | 'billing' | 'request' | 'unavailable'
export interface GroqFailure { kind: GroqFailureKind; status: number }

const MAX_FAILURE_BYTES = 32 * 1024
const MODEL = 'openai/gpt-oss-120b'

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

// Error bodies may include the entire prompt and failed generation. Keep them
// private, bound their size, and retain only a fixed classification afterwards.
async function readPrivateError(response: Response): Promise<Record<string, unknown> | undefined> {
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  try {
    reader = response.body?.getReader()
    if (!reader) return undefined
    const chunks: Uint8Array[] = []
    let length = 0
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      length += chunk.value.byteLength
      if (length > MAX_FAILURE_BYTES) {
        try { await reader.cancel() } catch { /* Cancellation must not reveal an upstream error. */ }
        return undefined
      }
      chunks.push(chunk.value)
    }
    const bytes = new Uint8Array(length)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    const payload: unknown = JSON.parse(new TextDecoder().decode(bytes))
    return record(record(payload)?.error)
  } catch {
    return undefined
  } finally {
    try { reader?.releaseLock() } catch { /* The response may already have been aborted. */ }
  }
}

function field(error: Record<string, unknown> | undefined, key: string): string {
  const value = error?.[key]
  return typeof value === 'string' ? value.slice(0, 8192).trim().toLowerCase() : ''
}

const contextCodes = new Set(['context_length_exceeded', 'context_window_exceeded', 'max_context_length_exceeded', 'token_limit_exceeded', 'tokens_limit_exceeded', 'max_tokens_exceeded', 'too_many_tokens', 'request_too_large', 'payload_too_large', 'input_too_long', 'prompt_too_long'])
const modelCodes = new Set(['model_not_found', 'model_not_available', 'model_decommissioned', 'unsupported_model', 'invalid_model'])
const billingCodes = new Set(['insufficient_quota', 'billing_hard_limit_reached', 'billing_not_active', 'insufficient_balance', 'payment_required', 'credit_balance_exhausted', 'quota_exceeded'])
const authCodes = new Set(['invalid_api_key', 'authentication_error', 'authentication_failed', 'invalid_authentication'])
const accessCodes = new Set(['permission_denied', 'permission_error', 'access_denied', 'model_permission_denied'])
const rateCodes = new Set(['rate_limit_exceeded', 'rate_limit_error', 'tokens_per_minute_exceeded', 'requests_per_minute_exceeded'])
const formatCodes = new Set(['json_validate_failed', 'schema_validation_failed', 'invalid_json_schema'])

/** Classify only recognized provider signals; unknown 400s must not trigger a retry. */
export async function readGroqFailure(response: Response, format: GroqResponseFormat): Promise<GroqFailure> {
  const status = response.status
  const error = await readPrivateError(response)
  if (status === 401) return { kind: 'auth', status }
  if (status === 403) return { kind: 'access', status }
  if (status === 429) return { kind: 'rate_limit', status }
  if (status === 404) return { kind: 'model', status }
  if (status === 413) return { kind: 'context', status }
  if (status === 402) return { kind: 'billing', status }
  if (status >= 500 || status < 400) return { kind: 'unavailable', status }

  const code = field(error, 'code')
  const type = field(error, 'type')
  const param = field(error, 'param')
  const message = field(error, 'message')
  const hasCode = (codes: Set<string>) => codes.has(code) || codes.has(type)

  // More specific failures win even if the message also mentions JSON/schema.
  if (hasCode(authCodes) || /\b(?:invalid|expired|missing|incorrect)\b.{0,24}\b(?:api key|authentication|authorization token)\b|\b(?:api key|authentication|authorization token)\b.{0,32}\b(?:invalid|expired|missing|incorrect|required|failed)\b/.test(message)) return { kind: 'auth', status }
  if (hasCode(accessCodes) || /\b(?:access|permission) denied\b|\binsufficient permissions?\b/.test(message)) return { kind: 'access', status }
  if (hasCode(rateCodes) || /\brate[ _-]limit\b.{0,32}\b(?:reached|exceed|exceeded|limit)\b/.test(message)) return { kind: 'rate_limit', status }
  if (hasCode(billingCodes) || /\b(?:billing|payment|credit balance|quota)\b.{0,48}\b(?:required|inactive|exhausted|insufficient|limit|exceeded|too low)\b|\b(?:exceeded|exhausted)\b.{0,24}\bquota\b/.test(message)) return { kind: 'billing', status }
  if (hasCode(modelCodes) || param === 'model' || /\bmodel\b.{0,64}\b(?:not found|does not exist|decommissioned)\b/.test(message)) return { kind: 'model', status }
  if (hasCode(contextCodes) || /^(?:max_tokens|max_completion_tokens|context_length)$/.test(param) || /\bcontext[ _-](?:length|window|limit)\b|\b(?:token|tokens|context)\b.{0,48}\b(?:limit|exceeded|too (?:large|long))\b|\b(?:payload|request|input|prompt)\b.{0,32}\btoo (?:large|long)\b/.test(message)) return { kind: 'context', status }

  // Both supported formats can produce JSON-generation validation errors. The
  // caller decides whether another format remains available within its budget.
  const knownFormat = format === 'json_schema' || format === 'json_object'
  const formatParam = /^(?:response_format|json_schema)(?:$|[.\[])/.test(param)
  const formatMessage = /\bresponse[ _-]format\b|\bjson[ _-]schema\b|\bstructured[ _-]outputs?\b|\bschema[ _-]grammar\b|\b(?:failed|unable|could not) to generate (?:valid )?json\b|\bjson (?:generation|validation) (?:failed|failure|error)\b|\bgenerated json\b.{0,48}\b(?:invalid|not valid|validation|does not match the expected schema)\b/.test(message)
  if (knownFormat && (status === 400 || status === 422) && (hasCode(formatCodes) || formatParam || formatMessage)) return { kind: 'format', status }
  return { kind: 'request', status }
}

export function groqFailureError(failure: GroqFailure): AssistantError {
  const status = Number.isInteger(failure.status) && failure.status >= 0 && failure.status <= 599 ? failure.status : 502
  const suffix = `(Groq HTTP ${status}).`
  switch (failure.kind) {
    case 'auth': return new AssistantError(`Groq authentication failed ${suffix} Check GROQ_API_KEY in Vercel and redeploy.`, 503)
    case 'access': return new AssistantError(`Groq denied model access ${suffix} Check the API key's permission to use ${MODEL}.`, 503)
    case 'rate_limit': return new AssistantError(`Groq's rate limit was reached ${suffix} Wait a moment, or check your Groq usage limits.`, 503)
    case 'context': return new AssistantError(`The assistant request was too large for Groq ${suffix} Ask for fewer changes or shorten your prompt.`, 422)
    case 'model': return new AssistantError(`The configured Groq model is unavailable ${suffix} Check that ${MODEL} is enabled and supported.`, 503)
    case 'billing': return new AssistantError(`The Groq account's billing or quota needs attention ${suffix} Check your Groq billing and usage limits.`, 503)
    case 'format': return new AssistantError(`Groq could not validate the assistant's structured plan ${suffix} Try a simpler scheduling request.`, 502)
    case 'request': return new AssistantError(`Groq rejected the assistant request ${suffix} Check the server's provider configuration and retry.`, 502)
    default: return new AssistantError(`Groq is temporarily unavailable ${suffix} Try again shortly.`, 502)
  }
}

const failureKinds = new Set<GroqFailureKind>(['format', 'auth', 'access', 'rate_limit', 'context', 'model', 'billing', 'request', 'unavailable'])

export function logGroqFailure(failure: GroqFailure, format: GroqResponseFormat): void {
  console.warn({
    model: MODEL,
    status: Number.isInteger(failure.status) && failure.status >= 0 && failure.status <= 599 ? failure.status : 502,
    kind: failureKinds.has(failure.kind) ? failure.kind : 'unavailable',
    format: format === 'json_schema' ? 'json_schema' : 'json_object',
  })
}
