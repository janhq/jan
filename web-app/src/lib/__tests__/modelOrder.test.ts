import { describe, it, expect } from 'vitest'
import { sortModelsByName } from '../modelOrder'

const ids = (models: { id: string }[]) => models.map((m) => m.id)

describe('sortModelsByName', () => {
  it('orders models by name, ignoring case', () => {
    const models = [
      { id: 'phi-4' },
      { id: 'Llama-3.3-70B-Instruct' },
      { id: 'gpt-4o' },
      { id: 'DeepSeek-R1' },
    ] as Model[]

    expect(ids(sortModelsByName(models))).toEqual([
      'DeepSeek-R1',
      'gpt-4o',
      'Llama-3.3-70B-Instruct',
      'phi-4',
    ])
  })

  it('orders by the display name the user sees', () => {
    const models = [
      { id: 'deploy-a', displayName: 'Zeta' },
      { id: 'deploy-b', displayName: 'Alpha' },
    ] as Model[]

    expect(ids(sortModelsByName(models))).toEqual(['deploy-b', 'deploy-a'])
  })

  it('orders numbered versions by their number', () => {
    const models = [{ id: 'gpt-35-turbo' }, { id: 'gpt-4' }, { id: 'gpt-4o' }] as Model[]

    expect(ids(sortModelsByName(models))).toEqual([
      'gpt-4',
      'gpt-4o',
      'gpt-35-turbo',
    ])
  })

  it('leaves the stored list untouched', () => {
    const models = [{ id: 'b' }, { id: 'a' }] as Model[]

    sortModelsByName(models)

    expect(ids(models)).toEqual(['b', 'a'])
  })
})
