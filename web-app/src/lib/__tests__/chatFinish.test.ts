import { describe, it, expect } from 'vitest'
import type { UIMessage } from 'ai'
import {
  providerHasContextSetting,
  isContextLimitStop,
  isEmptyReply,
  offersContextIncrease,
} from '../chatFinish'

const reply = (parts: UIMessage['parts']): UIMessage => ({
  id: 'a1',
  role: 'assistant',
  parts,
})

describe('providerHasContextSetting', () => {
  it('is true only for local engines that own a ctx_len setting', () => {
    expect(providerHasContextSetting('llamacpp')).toBe(true)
    expect(providerHasContextSetting('mlx')).toBe(true)
    expect(providerHasContextSetting('anthropic')).toBe(false)
    expect(providerHasContextSetting('openai')).toBe(false)
    expect(providerHasContextSetting(undefined)).toBe(false)
  })
})

describe('isContextLimitStop', () => {
  const usage = { inputTokens: 30000, outputTokens: 1000 }

  it('flags a llamacpp length stop near the configured ctx_len', () => {
    expect(
      isContextLimitStop({ provider: 'llamacpp', usage, ctxLen: 32768 })
    ).toBe(true)
  })

  it('falls back to 32768 when a local model has no ctx_len', () => {
    expect(
      isContextLimitStop({ provider: 'mlx', usage, ctxLen: undefined })
    ).toBe(true)
  })

  it('does not flag a local length stop far below ctx_len', () => {
    expect(
      isContextLimitStop({ provider: 'llamacpp', usage, ctxLen: 131072 })
    ).toBe(false)
  })

  it('reads a string ctx_len the way the settings store keeps it', () => {
    expect(
      isContextLimitStop({ provider: 'llamacpp', usage, ctxLen: '131072' })
    ).toBe(false)
  })

  it('uses the launched n_ctx when ctx_len is left to auto-fit', () => {
    expect(
      isContextLimitStop({
        provider: 'llamacpp',
        usage: { inputTokens: 3800, outputTokens: 200 },
        ctxLen: '',
        launchedCtxLen: 4096,
      })
    ).toBe(true)
  })

  it('never flags cloud providers, whose length stop is the output cap', () => {
    expect(
      isContextLimitStop({ provider: 'anthropic', usage, ctxLen: undefined })
    ).toBe(false)
    expect(
      isContextLimitStop({ provider: 'openai', usage, ctxLen: 4096 })
    ).toBe(false)
  })
})

describe('isEmptyReply', () => {
  const base = { isAbort: false, isError: false, finishReason: 'stop' }

  it('is true for a finished assistant turn with no content', () => {
    expect(isEmptyReply({ ...base, message: reply([]) })).toBe(true)
    expect(
      isEmptyReply({ ...base, message: reply([{ type: 'text', text: '  ' }]) })
    ).toBe(true)
  })

  it('is false when the reply has text', () => {
    expect(
      isEmptyReply({ ...base, message: reply([{ type: 'text', text: 'hi' }]) })
    ).toBe(false)
  })

  it('is false for aborted, errored and tool-call turns', () => {
    const empty = reply([])
    expect(isEmptyReply({ ...base, isAbort: true, message: empty })).toBe(false)
    expect(isEmptyReply({ ...base, isError: true, message: empty })).toBe(false)
    expect(
      isEmptyReply({ ...base, finishReason: 'tool-calls', message: empty })
    ).toBe(false)
  })

  it('is false for user messages', () => {
    expect(
      isEmptyReply({ ...base, message: { id: 'u', role: 'user', parts: [] } })
    ).toBe(false)
  })
})

describe('offersContextIncrease', () => {
  const overflow = 'the request exceeds the available context size.'

  it('offers the increase for local providers on a context error', () => {
    expect(offersContextIncrease('llamacpp', overflow)).toBe(true)
    expect(
      offersContextIncrease(
        'mlx',
        'input length and `max_tokens` exceed context limit'
      )
    ).toBe(true)
  })

  it('never offers it for cloud providers, where ctx_len does nothing', () => {
    expect(offersContextIncrease('anthropic', overflow)).toBe(false)
    expect(
      offersContextIncrease(
        'anthropic',
        'input length and `max_tokens` exceed context limit: 1 + 2 > 2'
      )
    ).toBe(false)
  })

  it('does not offer it for unrelated errors', () => {
    expect(offersContextIncrease('llamacpp', 'connection refused')).toBe(false)
    expect(offersContextIncrease('llamacpp', undefined)).toBe(false)
  })
})
