import { describe, expect, it } from 'vitest'
import {
  OLLAMA_RUN_ADVANCED_OPTION_FIELDS,
  OLLAMA_RUN_ADVANCED_REQUEST_FIELDS,
  OLLAMA_RUN_COMMON_FIELDS,
  buildOllamaRunPayload,
} from '../ollamaRunSchema'

describe('ollamaRunSchema', () => {
  it('keeps the common field names exactly', () => {
    expect(OLLAMA_RUN_COMMON_FIELDS).toEqual([
      'model',
      'keep_alive',
      'num_ctx',
      'num_predict',
      'temperature',
      'top_k',
      'top_p',
      'min_p',
      'stop',
    ])
  })

  it('keeps advanced request field names exactly', () => {
    expect(OLLAMA_RUN_ADVANCED_REQUEST_FIELDS).toEqual([
      'suffix',
      'system',
      'template',
      'context',
      'raw',
      'format',
      'think',
      'truncate',
      'shift',
      'logprobs',
      'top_logprobs',
      '_debug_render_only',
    ])
  })

  it('keeps advanced option field names exactly', () => {
    expect(OLLAMA_RUN_ADVANCED_OPTION_FIELDS).toEqual([
      'num_keep',
      'seed',
      'typical_p',
      'repeat_last_n',
      'repeat_penalty',
      'presence_penalty',
      'frequency_penalty',
      'num_batch',
      'num_gpu',
      'main_gpu',
      'use_mmap',
      'num_thread',
    ])
  })

  it('omits empty values and nests option fields under options', () => {
    const payload = buildOllamaRunPayload({
      model: 'qwen2.5',
      keep_alive: '',
      num_ctx: 4096,
      num_predict: undefined,
      temperature: 0.7,
      top_k: null,
      top_p: '',
      min_p: 0,
      stop: [],
      suffix: '',
      system: 'You are helpful',
      template: '',
      context: '{"foo":"bar"}',
      raw: true,
      format: '{"type":"json_object"}',
      think: 'true',
      truncate: undefined,
      shift: null,
      logprobs: '',
      top_logprobs: 3,
      _debug_render_only: false,
      num_keep: '',
      seed: 42,
      typical_p: null,
      repeat_last_n: '',
      repeat_penalty: 1.1,
      presence_penalty: 0,
      frequency_penalty: undefined,
      num_batch: '',
      num_gpu: 1,
      main_gpu: '',
      use_mmap: true,
      num_thread: 8,
    })

    expect(payload).toEqual({
      model: 'qwen2.5',
      system: 'You are helpful',
      context: { foo: 'bar' },
      raw: true,
      format: { type: 'json_object' },
      think: true,
      top_logprobs: 3,
      _debug_render_only: false,
      options: {
        num_ctx: 4096,
        temperature: 0.7,
        min_p: 0,
        seed: 42,
        repeat_penalty: 1.1,
        presence_penalty: 0,
        num_gpu: 1,
        use_mmap: true,
        num_thread: 8,
      },
    })
  })

  it('throws field-specific error for invalid context JSON', () => {
    expect(() =>
      buildOllamaRunPayload({
        model: 'qwen2.5',
        context: '{"foo":',
      })
    ).toThrow('context 需要有效的 JSON')
  })

  it('throws field-specific error for invalid format JSON', () => {
    expect(() =>
      buildOllamaRunPayload({
        model: 'qwen2.5',
        format: '{"type":',
      })
    ).toThrow('format 需要有效的 JSON')
  })

  it('normalizes think false to boolean false', () => {
    const payload = buildOllamaRunPayload({
      model: 'qwen2.5',
      think: 'false',
    })

    expect(payload).toEqual({
      model: 'qwen2.5',
      think: false,
    })
  })

  it('keeps think level values as strings', () => {
    const high = buildOllamaRunPayload({ model: 'qwen2.5', think: 'high' })
    const medium = buildOllamaRunPayload({ model: 'qwen2.5', think: 'medium' })
    const low = buildOllamaRunPayload({ model: 'qwen2.5', think: 'low' })

    expect(high.think).toBe('high')
    expect(medium.think).toBe('medium')
    expect(low.think).toBe('low')
  })

  it('routes all exported schema fields exactly once between request and options', () => {
    const form = {
      model: 'm',
      keep_alive: '1m',
      num_ctx: 1,
      num_predict: 2,
      temperature: 0.1,
      top_k: 3,
      top_p: 0.8,
      min_p: 0.01,
      stop: ['<stop>'],
      suffix: 's',
      system: 'sys',
      template: 'tpl',
      context: '{"c":1}',
      raw: true,
      format: '{"type":"json_object"}',
      think: 'medium',
      truncate: false,
      shift: false,
      logprobs: true,
      top_logprobs: 4,
      _debug_render_only: false,
      num_keep: 5,
      seed: 6,
      typical_p: 0.7,
      repeat_last_n: 7,
      repeat_penalty: 1.2,
      presence_penalty: 0.2,
      frequency_penalty: 0.3,
      num_batch: 8,
      num_gpu: 1,
      main_gpu: 0,
      use_mmap: true,
      num_thread: 9,
    } as const

    const payload = buildOllamaRunPayload(form)
    const payloadOptions = (payload.options ?? {}) as Record<string, unknown>

    for (const field of OLLAMA_RUN_ADVANCED_REQUEST_FIELDS) {
      expect(payload).toHaveProperty(field)
      expect(payloadOptions).not.toHaveProperty(field)
    }

    for (const field of OLLAMA_RUN_ADVANCED_OPTION_FIELDS) {
      expect(payloadOptions).toHaveProperty(field)
      expect(payload).not.toHaveProperty(field)
    }

    const commonRequestFields = ['model', 'keep_alive']
    const commonOptionFields = OLLAMA_RUN_COMMON_FIELDS.filter(
      (field) => !commonRequestFields.includes(field)
    )

    for (const field of commonRequestFields) {
      expect(payload).toHaveProperty(field)
      expect(payloadOptions).not.toHaveProperty(field)
    }

    for (const field of commonOptionFields) {
      expect(payloadOptions).toHaveProperty(field)
      expect(payload).not.toHaveProperty(field)
    }
  })

  it('omits NaN and non-finite numeric values', () => {
    const payload = buildOllamaRunPayload({
      model: 'qwen2.5',
      num_ctx: NaN,
      num_predict: Infinity,
      top_k: -Infinity,
      temperature: 0.5,
    })

    expect(payload).toEqual({
      model: 'qwen2.5',
      options: {
        temperature: 0.5,
      },
    })
  })

  it('normalizes numeric strings and omits invalid numeric strings', () => {
    const payload = buildOllamaRunPayload({
      model: 'qwen2.5',
      temperature: '0.7',
      num_ctx: '-',
      top_p: '1e',
      num_thread: '8',
    })

    expect(payload).toEqual({
      model: 'qwen2.5',
      options: {
        temperature: 0.7,
        num_thread: 8,
      },
    })
  })
})
