import { describe, it, expect } from 'vitest'
import { getHuggingFaceUrl } from '../models'

describe('getHuggingFaceUrl', () => {
  // Regression test for #8634: pasting a full HuggingFace URL into the hub
  // stores the repo as model_name = 'meta-llama/Llama-3.1-8B' with
  // developer = 'meta-llama' (see convertHfRepoToCatalogModel). The org must
  // NOT be prepended a second time, otherwise the "View on HuggingFace" link
  // becomes https://huggingface.co/meta-llama/meta-llama/Llama-3.1-8B -> 404.
  it('does not duplicate the org when model_name already contains it (#8634)', () => {
    const model = {
      model_name: 'meta-llama/Llama-3.1-8B',
      developer: 'meta-llama',
    }

    expect(getHuggingFaceUrl(model)).toBe(
      'https://huggingface.co/meta-llama/Llama-3.1-8B'
    )
  })

  it('prepends the developer when model_name is a bare model name', () => {
    expect(
      getHuggingFaceUrl({ model_name: 'tinyllama', developer: 'cortexso' })
    ).toBe('https://huggingface.co/cortexso/tinyllama')
  })

  it('keeps the bare name when neither org nor developer is available', () => {
    expect(getHuggingFaceUrl({ model_name: 'tinyllama' })).toBe(
      'https://huggingface.co/tinyllama'
    )
  })
})
