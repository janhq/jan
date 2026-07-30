import { describe, it, expect } from 'vitest'
import {
  cleanHubSearchQuery,
  prioritizeExactModelMatches,
  type RankableCatalogModel,
} from '../searchRanking'

const model = (
  model_name: string,
  developer?: string,
  quantIds: string[] = []
): RankableCatalogModel => ({
  model_name,
  developer,
  quants: quantIds.map((model_id) => ({ model_id })),
})

describe('cleanHubSearchQuery', () => {
  it('strips huggingface host prefixes', () => {
    expect(
      cleanHubSearchQuery(
        'https://huggingface.co/unsloth/gemma-4-26B-A4B-it-qat-GGUF'
      )
    ).toBe('unsloth/gemma-4-26B-A4B-it-qat-GGUF')
  })

  it('leaves bare repo ids unchanged', () => {
    expect(cleanHubSearchQuery('unsloth/gemma-4-26B-A4B-it-qat-GGUF')).toBe(
      'unsloth/gemma-4-26B-A4B-it-qat-GGUF'
    )
  })
})

describe('prioritizeExactModelMatches', () => {
  it('moves an exact model_name match to the front', () => {
    const models = [
      model('gemma-related-other', 'someone'),
      model('gemma-4-26B-A4B-it-qat-GGUF', 'unsloth'),
      model('another-gemma', 'org'),
    ]

    const ranked = prioritizeExactModelMatches(
      models,
      'unsloth/gemma-4-26B-A4B-it-qat-GGUF'
    )

    expect(ranked[0].developer).toBe('unsloth')
    expect(ranked[0].model_name).toBe('gemma-4-26B-A4B-it-qat-GGUF')
  })

  it('matches when model_name already includes the author prefix', () => {
    const models = [
      model('unsloth/gemma-nearby', 'unsloth'),
      model('unsloth/gemma-4-26B-A4B-it-qat-GGUF'),
      model('google/gemma-2b', 'google'),
    ]

    const ranked = prioritizeExactModelMatches(
      models,
      'unsloth/gemma-4-26B-A4B-it-qat-GGUF'
    )

    expect(ranked[0].model_name).toBe(
      'unsloth/gemma-4-26B-A4B-it-qat-GGUF'
    )
  })

  it('prefers exact quant ids over fuzzy neighbors', () => {
    const models = [
      model('neighbor-model', 'org', ['neighbor-Q4']),
      model('target-model', 'org', ['exact-quant-id']),
    ]

    const ranked = prioritizeExactModelMatches(models, 'exact-quant-id')
    expect(ranked[0].model_name).toBe('target-model')
  })

  it('is case-insensitive and stable for non-exact rows', () => {
    const models = [
      model('Alpha', 'a'),
      model('Beta', 'b'),
      model('Target', 'Org'),
    ]

    const ranked = prioritizeExactModelMatches(models, 'org/target')
    expect(ranked.map((m) => m.model_name)).toEqual([
      'Target',
      'Alpha',
      'Beta',
    ])
  })

  it('returns the input when the query is empty', () => {
    const models = [model('a'), model('b')]
    expect(prioritizeExactModelMatches(models, '   ')).toBe(models)
  })
})
