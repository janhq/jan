import { describe, expect, it } from 'vitest'
import { OUT_OF_CONTEXT_SIZE } from '@/utils/error'
import {
  applyCtxLenToModel,
  contextOverflowMessage,
  ctxLenMax,
  findProviderModelIndex,
  getModelCtxLen,
  isLocalEngineProvider,
  nextCtxLen,
  parseCtxLen,
  REMOTE_CTX_LEN_MAX,
  seedRemoteModelsCtxLen,
  withRemoteCtxLen,
} from '../model-context-size'

describe('parseCtxLen', () => {
  it('reads positive numbers', () => {
    expect(parseCtxLen(8192)).toBe(8192)
    expect(parseCtxLen(0)).toBeUndefined()
    expect(parseCtxLen(-1)).toBeUndefined()
    expect(parseCtxLen(Number.NaN)).toBeUndefined()
  })

  it('reads numeric strings and treats empty as unset', () => {
    expect(parseCtxLen('32768')).toBe(32768)
    expect(parseCtxLen('')).toBeUndefined()
    expect(parseCtxLen('  ')).toBeUndefined()
    expect(parseCtxLen('nope')).toBeUndefined()
  })
})

describe('getModelCtxLen', () => {
  it('returns undefined when ctx_len is missing or empty', () => {
    expect(getModelCtxLen(undefined)).toBeUndefined()
    expect(getModelCtxLen({ id: 'm' } as Model)).toBeUndefined()
    expect(
      getModelCtxLen({
        id: 'm',
        settings: { ctx_len: { controller_props: { value: '' } } },
      } as Model)
    ).toBeUndefined()
  })

  it('reads the persisted controller value', () => {
    expect(
      getModelCtxLen({
        id: 'm',
        settings: { ctx_len: { controller_props: { value: 98304 } } },
      } as Model)
    ).toBe(98304)
  })
})

describe('nextCtxLen', () => {
  it('uses the local 8k → 32k → ×1.5 ladder', () => {
    expect(nextCtxLen(4096, { max: 131072 })).toBe(8192)
    expect(nextCtxLen(8192, { max: 131072 })).toBe(32768)
    expect(nextCtxLen(32768, { max: 131072 })).toBe(49152)
  })

  it('caps at max so a fully-grown local window is a no-op', () => {
    expect(nextCtxLen(131072, { max: 131072 })).toBe(131072)
  })

  it('jumps a remote 8k/32k default past a ~34k prompt in one click', () => {
    expect(nextCtxLen(8192, { max: REMOTE_CTX_LEN_MAX, remote: true })).toBe(
      65536
    )
    expect(nextCtxLen(32768, { max: REMOTE_CTX_LEN_MAX, remote: true })).toBe(
      65536
    )
    const next = nextCtxLen(8192, {
      max: REMOTE_CTX_LEN_MAX,
      remote: true,
      minNeeded: 34000,
    })
    expect(next).toBeGreaterThan(34000 / 0.9)
    expect(next).toBe(65536)
  })

  it('honors minNeeded when the overflow is larger than the next step', () => {
    const next = nextCtxLen(65536, {
      max: REMOTE_CTX_LEN_MAX,
      remote: true,
      minNeeded: 200000,
    })
    expect(next).toBeGreaterThan(200000 / 0.9)
  })
})

describe('withRemoteCtxLen / seedRemoteModelsCtxLen', () => {
  it('seeds ctx_len without inventing a client cap', () => {
    const seeded = withRemoteCtxLen({ id: 'llama3.1', model: 'llama3.1' })
    expect(seeded.settings?.ctx_len?.key).toBe('ctx_len')
    expect(seeded.settings?.ctx_len?.title).toBe('Context Size')
    expect(seeded.settings?.ctx_len?.controller_props?.value).toBe('')
    expect(getModelCtxLen(seeded as Model)).toBeUndefined()
  })

  it('does not overwrite an existing ctx_len', () => {
    const existing = {
      id: 'm',
      settings: {
        ctx_len: { controller_props: { value: 98304 } },
      },
    }
    expect(withRemoteCtxLen(existing).settings?.ctx_len?.controller_props?.value).toBe(
      98304
    )
  })

  it('seeds every model that lacks ctx_len', () => {
    const models = seedRemoteModelsCtxLen([
      { id: 'a' },
      { id: 'b', settings: { ctx_len: { controller_props: { value: 4096 } } } },
    ])
    expect(models?.[0].settings?.ctx_len?.controller_props?.value).toBe('')
    expect(models?.[1].settings?.ctx_len?.controller_props?.value).toBe(4096)
  })
})

describe('applyCtxLenToModel', () => {
  it('writes a complete remote ctx_len setting so ModelSetting can render it', () => {
    const updated = applyCtxLenToModel({ id: 'm' } as Model, 65536, true)
    expect(updated.settings?.ctx_len?.key).toBe('ctx_len')
    expect(updated.settings?.ctx_len?.controller_type).toBe('input')
    expect(updated.settings?.ctx_len?.controller_props?.value).toBe(65536)
    expect(updated.settings?.ctx_len?.title).toBe('Context Size')
  })

  it('preserves a local ctx_len max when raising the value', () => {
    const updated = applyCtxLenToModel(
      {
        id: 'local',
        settings: {
          ctx_len: { controller_props: { value: 4096, max: 32768 } },
        },
      } as Model,
      8192,
      false
    )
    expect(updated.settings?.ctx_len?.controller_props?.value).toBe(8192)
    expect(updated.settings?.ctx_len?.controller_props?.max).toBe(32768)
  })
})

describe('Increase Context Size for a custom endpoint model', () => {
  it('raises and persists ctx_len far enough that a ~34k prompt is no longer client-capped', () => {
    const model = withRemoteCtxLen({
      id: 'qwen3',
      model: 'qwen3',
    }) as Model
    expect(getModelCtxLen(model)).toBeUndefined()

    const raised = nextCtxLen(0, {
      max: ctxLenMax(model, true),
      remote: true,
      minNeeded: 34000,
    })
    expect(raised).toBeGreaterThan(34000 / 0.9)

    const persisted = applyCtxLenToModel(model, raised, true)
    expect(getModelCtxLen(persisted)).toBe(raised)
    expect(persisted.settings?.ctx_len?.key).toBe('ctx_len')
    expect(34000 >= getModelCtxLen(persisted)! * 0.9).toBe(false)
  })
})

describe('findProviderModelIndex', () => {
  const models = [
    { id: 'alpha', model: 'alpha' },
    { id: 'beta-id', model: 'beta' },
  ] as Model[]

  it('matches by id, then model field', () => {
    expect(findProviderModelIndex(models, { id: 'alpha' })).toBe(0)
    expect(findProviderModelIndex(models, { id: 'missing', model: 'beta' })).toBe(
      1
    )
    expect(findProviderModelIndex(models, { id: 'nope' })).toBe(-1)
  })
})

describe('ctxLenMax / isLocalEngineProvider / contextOverflowMessage', () => {
  it('uses a 1M remote max and 128k local max by default', () => {
    expect(isLocalEngineProvider('llamacpp')).toBe(true)
    expect(isLocalEngineProvider('mlx')).toBe(true)
    expect(isLocalEngineProvider('ollama-custom')).toBe(false)
    expect(ctxLenMax(undefined, true)).toBe(REMOTE_CTX_LEN_MAX)
    expect(ctxLenMax(undefined, false)).toBe(131072)
  })

  it('embeds token counts so a later Increase click can clear the overflow', () => {
    expect(contextOverflowMessage(34000, 8192)).toBe(
      'request (34000 tokens) exceeds the available context size (8192 tokens)'
    )
    expect(contextOverflowMessage()).toBe(OUT_OF_CONTEXT_SIZE)
  })
})
