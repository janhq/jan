import { describe, it, expect, vi } from 'vitest'
import {
  fetchAzureDeployments,
  isDeployedModelsOnly,
  visibleProviderModels,
} from '../azureDeployments'

const BASE_URL = 'https://my-resource.services.ai.azure.com/openai/v1'
const DEPLOYMENTS_URL =
  'https://my-resource.services.ai.azure.com/openai/deployments?api-version=2022-12-01'
const MODELS_URL = `${BASE_URL}/models`

const azure = (overrides: Partial<ModelProvider> = {}) =>
  ({
    provider: 'azure',
    active: true,
    api_key: 'user-azure-key',
    base_url: BASE_URL,
    models: [],
    settings: [],
    ...overrides,
  }) as ModelProvider

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

// What a Foundry resource returned on 2026-10-10 (trimmed).
const deploymentsBody = {
  data: [
    { id: 'gpt-6-astra', model: 'gpt-6-astra', status: 'succeeded' },
    { id: 'gpt-6.1-sol', model: 'gpt-6.1-sol', status: 'succeeded' },
    { id: 'Decision-1', model: 'Microsoft-Decision-1', status: 'succeeded' },
    { id: 'my-custom', model: 'some-unlisted-model', status: 'succeeded' },
    { id: 'still-creating', model: 'gpt-6-astra', status: 'creating' },
  ],
}
const modelsBody = {
  data: [
    { id: 'gpt-6-astra', capabilities: { chat_completion: true } },
    { id: 'gpt-6.1-sol', capabilities: { chat_completion: true } },
    { id: 'Microsoft-Decision-1', capabilities: { chat_completion: false } },
  ],
}

const stubFetch = () =>
  vi.fn<typeof globalThis.fetch>(async (input) => {
    const url = String(input)
    if (url === DEPLOYMENTS_URL) return json(deploymentsBody)
    if (url === MODELS_URL) return json(modelsBody)
    return json({ error: 'unexpected' }, 404)
  })

describe('fetchAzureDeployments', () => {
  it('lists the deployment names that can be used for chat', async () => {
    const fetchImpl = stubFetch()

    const names = await fetchAzureDeployments(azure(), fetchImpl)

    // Decision-1 is not a chat model, a deployment still being created cannot
    // serve requests yet, and a model missing from the catalog is kept.
    expect(names).toEqual(['gpt-6-astra', 'gpt-6.1-sol', 'my-custom'])
  })

  it('authenticates with the api-key header the deployments API expects', async () => {
    const fetchImpl = stubFetch()

    await fetchAzureDeployments(azure(), fetchImpl)

    const [, init] = fetchImpl.mock.calls.find(
      ([input]) => String(input) === DEPLOYMENTS_URL
    )!
    expect(new Headers(init?.headers).get('api-key')).toBe('user-azure-key')
  })

  it('fails without an endpoint or a key instead of guessing', async () => {
    await expect(
      fetchAzureDeployments(azure({ base_url: '' }), stubFetch())
    ).rejects.toThrow()
    await expect(
      fetchAzureDeployments(azure({ api_key: '' }), stubFetch())
    ).rejects.toThrow()
  })

  it('fails when the deployments API is unavailable', async () => {
    const fetchImpl = vi.fn<typeof globalThis.fetch>(async () =>
      json({ error: { code: '404' } }, 404)
    )

    await expect(fetchAzureDeployments(azure(), fetchImpl)).rejects.toThrow(
      /404/
    )
  })
})

describe('visibleProviderModels', () => {
  const models = ['gpt-6-astra', 'gpt-4o', 'Llama-3.3-70B-Instruct'].map(
    (id) => ({ id }) as Model
  )

  it('shows only deployed Azure models by default', () => {
    const provider = azure({ models, deployments: ['gpt-6-astra'] })

    expect(isDeployedModelsOnly(provider)).toBe(true)
    expect(visibleProviderModels(provider).map((m) => m.id)).toEqual([
      'gpt-6-astra',
    ])
  })

  it('shows every model once the user turns the switch off', () => {
    const provider = azure({
      models,
      deployments: ['gpt-6-astra'],
      deployed_models_only: false,
    })

    expect(visibleProviderModels(provider)).toEqual(models)
  })

  it('shows every model while the deployments are unknown', () => {
    expect(visibleProviderModels(azure({ models }))).toEqual(models)
  })

  it('leaves other providers alone', () => {
    const openai = {
      ...azure({ models, deployments: ['gpt-6-astra'] }),
      provider: 'openai',
    } as ModelProvider

    expect(visibleProviderModels(openai)).toEqual(models)
  })
})
