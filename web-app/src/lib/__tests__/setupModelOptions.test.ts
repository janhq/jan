import { describe, expect, it } from 'vitest'
import { pickMmproj } from '../setupModelOptions'
import type { CatalogModel } from '@/services/models/types'

const model = (over: Partial<CatalogModel> = {}): CatalogModel => ({
  model_name: 'org/some-model',
  description: '',
  downloads: 100,
  quants: [{ model_id: 'some-model-q4_k_m', path: 'p/q4', file_size: '4 GB' }],
  ...over,
})

describe('pickMmproj', () => {
  it('prefers the F16 projector', () => {
    expect(
      pickMmproj(
        model({
          mmproj_models: [
            { model_id: 'mmproj-q8_0', path: 'p/q8', file_size: '1 GB' },
            { model_id: 'mmproj-f16', path: 'p/f16', file_size: '2 GB' },
          ],
        })
      )
    ).toBe('p/f16')
  })

  it('falls back to the first projector when F16 is absent', () => {
    expect(
      pickMmproj(
        model({
          mmproj_models: [
            { model_id: 'mmproj-q8_0', path: 'p/q8', file_size: '1 GB' },
          ],
        })
      )
    ).toBe('p/q8')
  })

  it('returns nothing for a text-only model', () => {
    expect(pickMmproj(model())).toBeUndefined()
    expect(pickMmproj(model({ mmproj_models: [] }))).toBeUndefined()
  })
})
