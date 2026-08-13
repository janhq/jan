import { describe, expect, it, vi } from 'vitest'
import type { ProviderObject } from '@janhq/core'
import { ensureCodeModelStarted } from '../codeModelStartup'

describe('ensureCodeModelStarted', () => {
  it.each(['llamacpp', 'mlx'])('starts a %s model before Cowork agent runs', async (providerName) => {
    const startModel = vi.fn().mockResolvedValue(undefined)
    const provider = {
      provider: providerName,
      models: [{ id: 'local-model' }],
    } as ProviderObject

    await ensureCodeModelStarted({ startModel }, provider, 'local-model')

    expect(startModel).toHaveBeenCalledWith(provider, 'local-model')
  })

  it('does not start remote models', async () => {
    const startModel = vi.fn().mockResolvedValue(undefined)
    const provider = { provider: 'openai', models: [{ id: 'remote-model' }] } as ProviderObject

    await ensureCodeModelStarted({ startModel }, provider, 'remote-model')

    expect(startModel).not.toHaveBeenCalled()
  })
})
