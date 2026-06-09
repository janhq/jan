import { beforeEach, describe, expect, it } from 'vitest'
import { useCodexProviderProfiles } from '../codex-provider-profile-store'

beforeEach(() => {
  useCodexProviderProfiles.setState({
    profiles: {},
    activeProfileId: null,
  })
  localStorage.clear()
})

describe('useCodexProviderProfiles', () => {
  it('persists Codex transport with runtime provider profiles', () => {
    const saved = useCodexProviderProfiles.getState().upsertProfile({
      name: 'Local proto CLI',
      baseUrl: 'http://localhost:11434/v1',
      model: 'qwen3-coder',
      apiKeyEnv: 'OLLAMA_API_KEY',
      codexHome: '.codex/profiles/proto',
      transport: 'proto',
      providerType: 'ollama',
      approvalPolicy: 'on-request',
      sandbox: 'workspace-write',
      addDirs: ['/tmp/extra', '../sibling'],
      advancedConfigSnippet: '[hooks]\non-file-change = ["lint"]',
    })

    expect(saved.transport).toBe('proto')
    expect(useCodexProviderProfiles.getState().profiles[saved.id]).toEqual(
      expect.objectContaining({
        transport: 'proto',
        addDirs: ['/tmp/extra', '../sibling'],
        advancedConfigSnippet: '[hooks]\non-file-change = ["lint"]',
      })
    )
  })

  it('defaults profile transport to app-server when omitted', () => {
    const saved = useCodexProviderProfiles.getState().upsertProfile({
      name: 'Default app server',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-5',
      codexHome: '.codex/profiles/openai',
      providerType: 'openai-compatible',
    })

    expect(saved.transport).toBe('app-server')
  })
})
