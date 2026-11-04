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

import { useGeneralSetting } from '@/hooks/useGeneralSetting'
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

  it('offers tools on the models of a provider that declares them', async () => {
    renderHook(() => useExtensionProviders())
    const contributes = providerManifest.contributes!
    await host.activateBuiltin(
      builtin(
        {
          ...providerManifest,
          contributes: {
            ...contributes,
            providers: [
              { ...contributes.providers![0], capabilities: ['completion', 'tools'] },
            ],
          },
        },
        {
          activate: (ctx) => {
            ctx.subscriptions.add(
              ctx.providers.registerProvider('local', {
                listModels: async () => [{ id: 'hello-1' }],
              })
            )
          },
        }
      )
    )
    await waitFor(() =>
      expect(
        useModelProvider.getState().getProviderByName('acme.llm/local')?.models
      ).toEqual([
        expect.objectContaining({
          id: 'hello-1',
          capabilities: ['completion', 'tools'],
        }),
      ])
    )
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

  it('renames the provider when the app language changes', async () => {
    renderHook(() => useExtensionProviders())
    const localized = manifest('acme.llm', {
      ...providerManifest,
      displayName: '%name%',
      contributes: {
        ...providerManifest.contributes,
        providers: [
          {
            id: 'local',
            displayName: '%local%',
            baseUrl: 'http://127.0.0.1:11999/v1',
          },
        ],
      },
      l10n: {
        en: { name: 'Acme', local: 'Acme Local' },
        ja: { name: 'Akume', local: 'Akume Rokaru' },
      },
    })
    await host.activateBuiltin(
      builtin(localized, {
        activate: (ctx) => {
          ctx.subscriptions.add(ctx.providers.registerProvider('local', {}))
        },
      })
    )
    const current = () =>
      useModelProvider.getState().getProviderByName('acme.llm/local')
    await waitFor(() =>
      expect(current()).toMatchObject({
        display_name: 'Acme Local',
        source: { extensionName: 'Acme' },
      })
    )
    act(() => useGeneralSetting.getState().setCurrentLanguage('ja'))
    await waitFor(() =>
      expect(current()).toMatchObject({
        display_name: 'Akume Rokaru',
        source: { extensionName: 'Akume' },
      })
    )
    act(() => useGeneralSetting.getState().setCurrentLanguage('en'))
  })
})
