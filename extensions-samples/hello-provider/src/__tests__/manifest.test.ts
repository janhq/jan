import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  API_VERSION,
  isApiCompatible,
  validateManifest,
} from '@janhq/extension-api'

const pkg: unknown = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8')
)

describe('hello-provider manifest', () => {
  it('passes the validator the host runs on load', () => {
    const result = validateManifest(pkg)
    expect(result.ok ? [] : result.errors).toEqual([])
  })

  it('targets the extension API this host provides', () => {
    const result = validateManifest(pkg)
    if (!result.ok) throw new Error('invalid manifest')
    expect(isApiCompatible(result.manifest.apiVersion, API_VERSION)).toBe(true)
  })

  it('requests only what it uses', () => {
    const result = validateManifest(pkg)
    if (!result.ok) throw new Error('invalid manifest')
    const { manifest } = result
    expect(manifest.id).toBe('jan-samples.hello-provider')
    expect(manifest.permissions).toEqual([
      'ui:notify',
      'tools',
      'providers',
      'network:127.0.0.1',
    ])
    expect(manifest.contributes?.providers).toEqual([
      {
        id: 'hello-local',
        displayName: 'Hello Local',
        baseUrl: 'http://127.0.0.1:11999/v1',
      },
    ])
  })
})
