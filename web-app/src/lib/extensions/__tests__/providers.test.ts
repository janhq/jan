import { describe, expect, it } from 'vitest'
import type { ContributionState } from '../contributions'
import { listExtensionProviders, toModelProvider } from '../providers'

const state = (): ContributionState => ({
  extensions: { 'acme.llm': { displayName: 'Acme LLM' } },
  commands: {},
  menus: {},
  statusItems: {},
  settings: {},
  tools: {},
  providers: {
    'acme.llm': {
      local: {
        id: 'local',
        displayName: 'Acme Local',
        baseUrl: 'http://127.0.0.1:11999/v1',
        handler: {},
      },
    },
  },
})

describe('extension providers', () => {
  it('lists a bound provider with its extension display name', () => {
    expect(listExtensionProviders(state())).toEqual([
      {
        extensionId: 'acme.llm',
        extensionName: 'Acme LLM',
        contribution: {
          id: 'local',
          displayName: 'Acme Local',
          baseUrl: 'http://127.0.0.1:11999/v1',
        },
      },
    ])
  })

  it('gives a model only completion when nothing is declared', () => {
    const [active] = listExtensionProviders(state())
    const provider = toModelProvider(active, [{ id: 'm1' }], undefined)
    expect(provider.models.map((m) => m.capabilities)).toEqual([['completion']])
  })

  it('gives models the capabilities their provider declares', () => {
    const s = state()
    s.providers['acme.llm'].local.capabilities = ['completion', 'tools']
    const [active] = listExtensionProviders(s)
    const provider = toModelProvider(active, [{ id: 'm1' }], undefined)
    expect(provider.models[0].capabilities).toEqual(['completion', 'tools'])
  })

  it('lets a listed model override its provider capabilities', () => {
    const s = state()
    s.providers['acme.llm'].local.capabilities = ['completion', 'tools']
    const [active] = listExtensionProviders(s)
    const provider = toModelProvider(
      active,
      [{ id: 'm1' }, { id: 'e1', capabilities: ['embeddings'] }],
      undefined
    )
    expect(provider.models.map((m) => m.capabilities)).toEqual([
      ['completion', 'tools'],
      ['embeddings'],
    ])
  })

  it('maps to a provider carrying its display name and owning extension', () => {
    const [active] = listExtensionProviders(state())
    const provider = toModelProvider(active, [{ id: 'm1' }], undefined)
    expect(provider.provider).toBe('acme.llm/local')
    expect(provider.display_name).toBe('Acme Local')
    expect(provider.source).toEqual({
      extensionId: 'acme.llm',
      extensionName: 'Acme LLM',
    })
  })
})
