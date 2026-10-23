import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ContributionStore, useContributions } from '@/lib/extensions/contributions'
import { ExtensionHost } from '@/lib/extensions/host'
import { builtin, manifest } from '@/lib/extensions/__tests__/fixtures'
import {
  memoryAppSettings,
  memorySecrets,
} from '@/lib/extensions/__tests__/memory'

const h = vi.hoisted(() => ({ host: undefined as unknown }))
vi.mock('@/lib/extensions/host', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/extensions/host')>()),
  getExtensionHost: () => h.host,
}))

import { useModelProvider } from '@/hooks/useModelProvider'
import { useExtensionProviders } from '../useExtensionProviders'

const providerManifest = manifest('acme.llm', {
  permissions: ['providers', 'network:127.0.0.1'],
  contributes: {
    settings: [
      {
        key: 'apiKey',
        title: 'API key',
        secret: true,
        control: { type: 'input', default: '' },
      },
    ],
    providers: [
      {
        id: 'local',
        displayName: 'Local',
        baseUrl: 'http://127.0.0.1:11999/v1',
        apiKeySetting: 'apiKey',
      },
    ],
  },
})

describe('useExtensionProviders', () => {
  let host: ExtensionHost

  beforeEach(() => {
    host = new ExtensionHost({
      appSettings: memoryAppSettings(),
      secrets: memorySecrets(),
      notify: vi.fn(),
      contributions: new ContributionStore(useContributions),
    })
    h.host = host
    useModelProvider.setState({
      providers: [
        { provider: 'openai', active: true, settings: [], models: [] },
      ],
    })
  })

  afterEach(async () => {
    await host.deactivateAll()
  })

  it('adds a bound provider as OpenAI-compatible, marked with its extension', async () => {
    renderHook(() => useExtensionProviders())
    await host.activateBuiltin(
      builtin(providerManifest, {
        activate: (ctx) => {
          ctx.subscriptions.add(
            ctx.providers.registerProvider('local', {
              listModels: async () => [{ id: 'hello-1' }],
            })
          )
        },
      })
    )
    await act(async () => {
      await host.settings.setSettingValue('acme.llm', 'apiKey', 'sk-1')
    })

    await waitFor(() =>
      expect(
        useModelProvider.getState().getProviderByName('acme.llm/local')
      ).toMatchObject({
        base_url: 'http://127.0.0.1:11999/v1',
        api_key: 'sk-1',
        source: { extensionId: 'acme.llm' },
        models: [expect.objectContaining({ id: 'hello-1' })],
      })
    )
    // OpenAI-compatible is the default wire format.
    expect(
      useModelProvider.getState().getProviderByName('acme.llm/local')?.api_type
    ).toBeUndefined()
    expect(useModelProvider.getState().getProviderByName('openai')).toBeDefined()

    // Never written to disk.
    const persisted = useModelProvider.persist
      .getOptions()
      .partialize?.(useModelProvider.getState()) as { providers: ModelProvider[] }
    expect(persisted.providers.map((p) => p.provider)).toEqual(['openai'])
  })

  it('removes the provider when its extension stops', async () => {
    renderHook(() => useExtensionProviders())
    await host.activateBuiltin(
      builtin(providerManifest, {
        activate: (ctx) => {
          ctx.subscriptions.add(ctx.providers.registerProvider('local', {}))
        },
      })
    )
    await waitFor(() =>
      expect(
        useModelProvider.getState().getProviderByName('acme.llm/local')
      ).toBeDefined()
    )
    await act(async () => {
      await host.deactivateAll()
    })
    await waitFor(() =>
      expect(
        useModelProvider.getState().getProviderByName('acme.llm/local')
      ).toBeUndefined()
    )
  })
})

