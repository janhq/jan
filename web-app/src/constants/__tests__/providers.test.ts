import { describe, expect, it } from 'vitest'

import { predefinedProviders } from '../providers'

describe('predefinedProviders', () => {
  it('registers DaoXE for authenticated model discovery', () => {
    const provider = predefinedProviders.find((item) => item.provider === 'daoxe')

    expect(provider).toMatchObject({
      active: true,
      api_key: '',
      base_url: 'https://daoxe.com/v1',
      explore_models_url: 'https://daoxe.com/pricing',
      models: [],
    })
    expect(provider?.settings).toEqual([
      expect.objectContaining({
        key: 'api-key',
        controller_props: expect.objectContaining({
          type: 'password',
          value: '',
        }),
      }),
    ])
  })
})
