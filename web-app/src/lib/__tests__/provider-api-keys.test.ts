import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  providerHasConfiguredRemoteAuth,
  providerHasRemoteApiKeys,
} from '@/lib/provider-api-keys'

vi.mock('@/lib/xai-oauth', () => ({
  isXaiOAuthConnectedSync: vi.fn(() => false),
}))

import { isXaiOAuthConnectedSync } from '@/lib/xai-oauth'

describe('provider-api-keys', () => {
  beforeEach(() => {
    vi.mocked(isXaiOAuthConnectedSync).mockReturnValue(false)
  })

  it('providerHasRemoteApiKeys returns true when primary key is set', () => {
    expect(providerHasRemoteApiKeys({ api_key: 'sk-test' })).toBe(true)
  })

  it('providerHasConfiguredRemoteAuth treats xAI OAuth as configured', () => {
    vi.mocked(isXaiOAuthConnectedSync).mockReturnValue(true)
    expect(
      providerHasConfiguredRemoteAuth({
        provider: 'xai',
      })
    ).toBe(true)
  })

  it('providerHasConfiguredRemoteAuth ignores xAI OAuth for other providers', () => {
    vi.mocked(isXaiOAuthConnectedSync).mockReturnValue(true)
    expect(
      providerHasConfiguredRemoteAuth({
        provider: 'openrouter',
      })
    ).toBe(false)
  })
})