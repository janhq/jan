import { describe, it, expect, vi } from 'vitest'

vi.mock('@tauri-apps/plugin-http', () => ({ fetch: vi.fn() }))

const platform = vi.hoisted(() => ({ mac: false }))
vi.mock('@/lib/shortcuts/platform', () => ({
  get isMac() {
    return platform.mac
  },
}))

import {
  ProviderUnreachableError,
  refreshFailureText,
  withUnreachableErrors,
} from '../provider-unreachable'
import { fetchTopRemoteModels } from '../remoteModelCatalog'

const generic =
  'Failed to fetch models from acme. Please check your API key and base URL.'

describe('refreshFailureText', () => {
  it('shows the unreachable message, which names the URL, instead of blaming the key', () => {
    const err = new ProviderUnreachableError(
      "Couldn't reach the provider - the connection failed. (http://10.0.0.5:11434/v1/models)"
    )
    expect(refreshFailureText(err, generic)).toBe(err.message)
  })

  it('keeps the generic text for an HTTP status error', () => {
    expect(
      refreshFailureText(new Error('Authentication failed for acme'), generic)
    ).toBe(generic)
  })

  it('keeps the generic text for a non-Error rejection', () => {
    expect(refreshFailureText('boom', generic)).toBe(generic)
  })
})

describe('withUnreachableErrors', () => {
  const url = 'http://10.1.0.211:8080/v1/models'
  // `@tauri-apps/plugin-http` rejects with a plain string, not an Error.
  const rejecting = (reason: unknown) =>
    withUnreachableErrors(vi.fn().mockRejectedValue(reason) as never)

  it('turns a failed connection into an unreachable error naming the URL', async () => {
    const err = await rejecting(`error sending request for url (${url})`)(
      url
    ).catch((e) => e)
    expect(err).toBeInstanceOf(ProviderUnreachableError)
    expect(err.message).toMatch(/couldn't reach the provider/i)
    expect(err.message).toContain(url)
  })

  it('adds the macOS Local Network hint for a LAN address only on macOS', async () => {
    platform.mac = true
    const mac = await rejecting('error sending request')(url).catch((e) => e)
    expect(mac.message).toContain('Local Network')
    const publicHost = await rejecting('error sending request')(
      'https://api.test.com/v1/models'
    ).catch((e) => e)
    expect(publicHost.message).not.toContain('Local Network')

    platform.mac = false
    const other = await rejecting('error sending request')(url).catch((e) => e)
    expect(other.message).not.toContain('Local Network')
  })

  it('rethrows a rejection that is not a transport failure unchanged', async () => {
    const boom = new Error('something else broke')
    await expect(rejecting(boom)(url)).rejects.toBe(boom)
  })

  it('passes a response through, including an HTTP error status', async () => {
    const response = { ok: false, status: 401 } as Response
    const wrapped = withUnreachableErrors(
      vi.fn().mockResolvedValue(response) as never
    )
    await expect(wrapped(url)).resolves.toBe(response)
  })
})

// The refresh button on a provider with a remote catalog (api_type
// 'anthropic', Gemini, ...) goes through `fetchTopRemoteModels`, not through
// the provider service, so its failures reach the toast by a different route.
describe('refreshing a provider with a remote catalog', () => {
  it('shows the unreachable message when the gateway cannot be reached', async () => {
    const provider = {
      provider: 'acme',
      base_url: 'https://gateway.acme.test/v1',
      api_type: 'anthropic',
      api_key: 'k',
    } as never
    const fetchImpl = vi
      .fn()
      .mockRejectedValue('error sending request for url (https://gateway.acme.test/v1/models)')

    const err = await fetchTopRemoteModels(
      provider,
      withUnreachableErrors(fetchImpl as never)
    ).catch((e) => e)

    expect(refreshFailureText(err, generic)).toMatch(/couldn't reach the provider/i)
    expect(refreshFailureText(err, generic)).toContain(
      'https://gateway.acme.test/v1/models'
    )
  })

  it('keeps the generic text when the gateway answers with an error status', async () => {
    const provider = {
      provider: 'acme',
      base_url: 'https://gateway.acme.test/v1',
      api_type: 'anthropic',
      api_key: 'k',
    } as never
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: async () => ({}),
    })

    const err = await fetchTopRemoteModels(
      provider,
      withUnreachableErrors(fetchImpl as never)
    ).catch((e) => e)

    // The message contains "Failed to fetch models", which must not be taken
    // for a connection failure.
    expect(err).not.toBeInstanceOf(ProviderUnreachableError)
    expect(refreshFailureText(err, generic)).toBe(generic)
  })
})
