import { describe, it, expect } from 'vitest'
import { APICallError, RetryError } from 'ai'
import { rateLimitRetryDelayMs } from '../rateLimit'

const RATE_LIMIT_BODY = {
  message: 'Your requests to grok-4.7 for grok-4.7 in eastus2 have exceeded token rate limit.',
  type: 'too_many_requests',
  param: null,
  code: 'rate_limit_exceeded',
}

const http429 = (headers: Record<string, string>) =>
  new APICallError({
    message: RATE_LIMIT_BODY.message,
    url: 'https://example.openai.azure.com/openai/v1/responses',
    requestBodyValues: {},
    statusCode: 429,
    responseHeaders: headers,
    data: { error: RATE_LIMIT_BODY },
    isRetryable: true,
  })

describe('rateLimitRetryDelayMs', () => {
  // Azure's token counter only frees up when it resets, so its reset time is
  // the wait that works; retry-after is often shorter than that.
  it('waits for the token counter to reset on an HTTP 429', () => {
    expect(
      rateLimitRetryDelayMs(
        http429({ 'retry-after': '15', 'retry-after-ms': '15825', 'x-ratelimit-reset-tokens': '75' })
      )
    ).toBe(75_000)
  })

  it('falls back to retry-after, then to a minute', () => {
    expect(rateLimitRetryDelayMs(http429({ 'retry-after-ms': '15825' }))).toBe(15_825)
    expect(rateLimitRetryDelayMs(http429({ 'retry-after': '20' }))).toBe(20_000)
    expect(rateLimitRetryDelayMs(http429({}))).toBe(60_000)
  })

  // What the AI SDK throws after its own retries ran out.
  it('reads the last error after the SDK gave up retrying', () => {
    const error = new RetryError({
      message: 'Failed after 3 attempts.',
      reason: 'maxRetriesExceeded',
      errors: [http429({ 'retry-after': '15' }), http429({ 'x-ratelimit-reset-tokens': '30' })],
    })
    expect(rateLimitRetryDelayMs(error)).toBe(30_000)
  })

  // The Responses API can also fail mid-stream, after the HTTP response
  // started, with an error event and no headers to go by.
  it('recognises a rate-limit error event in the stream', () => {
    expect(
      rateLimitRetryDelayMs({ type: 'error', sequence_number: 12, error: RATE_LIMIT_BODY })
    ).toBe(60_000)
  })

  it('keeps the wait within bounds', () => {
    expect(rateLimitRetryDelayMs(http429({ 'x-ratelimit-reset-tokens': '600' }))).toBe(120_000)
    expect(rateLimitRetryDelayMs(http429({ 'x-ratelimit-reset-tokens': '0' }))).toBe(1_000)
  })

  it('ignores other errors', () => {
    expect(rateLimitRetryDelayMs(new Error('network down'))).toBeNull()
    expect(
      rateLimitRetryDelayMs(
        new APICallError({
          message: 'Bad request',
          url: 'https://example.openai.azure.com/openai/v1/responses',
          requestBodyValues: {},
          statusCode: 400,
          data: { error: { code: 'invalid_file' } },
        })
      )
    ).toBeNull()
    expect(
      rateLimitRetryDelayMs({ type: 'error', error: { code: 'server_error', type: 'server_error' } })
    ).toBeNull()
    expect(rateLimitRetryDelayMs(undefined)).toBeNull()
  })
})
