import { providerRemoteApiKeyChain } from '@/lib/provider-api-keys'

type FetchImpl = typeof globalThis.fetch

/**
 * The data-plane API that lists a resource's deployments with an API key. Later
 * api-versions dropped the route (they return 404); the v1 API has no
 * deployments list at all, only the resource's model catalog.
 */
const DEPLOYMENTS_API_VERSION = '2022-12-01'

type DeploymentRow = { id?: unknown; model?: unknown; status?: unknown }
type CatalogRow = { id?: unknown; capabilities?: { chat_completion?: unknown } }

/** Whether Azure should list only the models deployed on the user's resource. */
export function isDeployedModelsOnly(provider: ModelProvider): boolean {
  return provider.provider === 'azure' && provider.deployed_models_only !== false
}

/**
 * The provider's models the user should see. Azure's catalog offers every model
 * the resource could deploy, so with "deployed models only" on (the default)
 * only the deployments are shown. Until the deployments are known, nothing is
 * hidden.
 */
export function visibleProviderModels(provider: ModelProvider): Model[] {
  if (!isDeployedModelsOnly(provider) || !Array.isArray(provider.deployments)) {
    return provider.models
  }
  const deployed = new Set(provider.deployments)
  return provider.models.filter((model) => deployed.has(model.id))
}

async function getJson(
  fetchImpl: FetchImpl,
  url: string,
  keys: string[]
): Promise<unknown> {
  let lastStatus = 0
  for (let i = 0; i < keys.length; i++) {
    const response = await fetchImpl(url, {
      method: 'GET',
      headers: { 'api-key': keys[i] },
    })
    if (response.ok) return response.json()
    lastStatus = response.status
    if ([401, 403, 429].includes(response.status) && i < keys.length - 1) continue
    break
  }
  throw new Error(`Azure request failed: ${lastStatus} (${new URL(url).pathname})`)
}

const rowsOf = (body: unknown): unknown[] => {
  const data = (body as { data?: unknown })?.data
  return Array.isArray(data) ? data : []
}

/**
 * Names of the deployments on the user's Azure resource that can serve chat
 * requests. The deployment name is what Azure expects as the request's model.
 */
export async function fetchAzureDeployments(
  provider: ModelProvider,
  fetchImpl: FetchImpl
): Promise<string[]> {
  const baseUrl = provider.base_url?.trim().replace(/\/+$/, '')
  if (!baseUrl) throw new Error('No endpoint configured for azure')
  const keys = providerRemoteApiKeyChain(provider)
  if (keys.length === 0) throw new Error('No API key configured for azure')

  const origin = new URL(baseUrl).origin
  const deployments = rowsOf(
    await getJson(
      fetchImpl,
      `${origin}/openai/deployments?api-version=${DEPLOYMENTS_API_VERSION}`,
      keys
    )
  ) as DeploymentRow[]

  // The catalog says which base models can chat (embeddings, image and
  // decision models cannot). Without it nothing is excluded, which only costs
  // a few extra entries.
  const chatByModel = new Map<string, boolean>()
  try {
    for (const row of rowsOf(await getJson(fetchImpl, `${baseUrl}/models`, keys)) as CatalogRow[]) {
      if (typeof row.id === 'string') {
        chatByModel.set(row.id, row.capabilities?.chat_completion !== false)
      }
    }
  } catch (error) {
    console.warn('Azure model catalog unavailable; keeping every deployment:', error)
  }

  const names = deployments
    .filter((row) => row.status === undefined || row.status === 'succeeded')
    .filter((row) => typeof row.model !== 'string' || chatByModel.get(row.model) !== false)
    .map((row) => row.id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0)
  return [...new Set(names)]
}
