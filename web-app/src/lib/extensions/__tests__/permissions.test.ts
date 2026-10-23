import { describe, expect, it } from 'vitest'
import en from '@/locales/en/extensions.json'
import {
  PERMISSIONS,
  diffPermissions,
  matchesNetwork,
  parsePermission,
  riskOf,
} from '../permissions'

const resolve = (key: string): unknown =>
  key
    .replace(/^extensions:/, '')
    .split('.')
    .reduce<unknown>(
      (node, part) =>
        node && typeof node === 'object'
          ? (node as Record<string, unknown>)[part]
          : undefined,
      en
    )

describe('PERMISSIONS', () => {
  it('has an English title and description for every kind', () => {
    for (const [kind, info] of Object.entries(PERMISSIONS)) {
      expect(typeof resolve(info.titleKey), kind).toBe('string')
      expect(typeof resolve(info.descriptionKey), kind).toBe('string')
    }
  })

  it('rates a wildcard network grant higher than a single host', () => {
    expect(riskOf('network:api.acme.dev')).toBe('medium')
    expect(riskOf('network:*')).toBe('high')
    expect(riskOf('ui:notify')).toBe('low')
    expect(riskOf('tools')).toBe('high')
  })
})

describe('parsePermission', () => {
  it('splits network grants into their host', () => {
    expect(parsePermission('network:*.acme.dev')).toEqual({
      kind: 'network',
      host: '*.acme.dev',
    })
    expect(parsePermission('tools')).toEqual({ kind: 'tools' })
  })

  it('rejects anything that is not a permission', () => {
    expect(parsePermission('network:')).toBeUndefined()
    expect(parsePermission('network:https://x.dev')).toBeUndefined()
    expect(parsePermission('root')).toBeUndefined()
  })
})

describe('matchesNetwork', () => {
  it('matches an exact host over https', () => {
    expect(matchesNetwork('network:api.acme.dev', 'https://api.acme.dev/v1')).toBe(true)
    expect(matchesNetwork('network:api.acme.dev', 'https://acme.dev/')).toBe(false)
  })

  it('matches subdomains of a wildcard, not its apex', () => {
    expect(matchesNetwork('network:*.example.com', 'https://a.example.com/')).toBe(true)
    expect(matchesNetwork('network:*.example.com', 'https://a.b.example.com/')).toBe(true)
    expect(matchesNetwork('network:*.example.com', 'https://example.com/')).toBe(false)
    expect(matchesNetwork('network:*.example.com', 'https://badexample.com/')).toBe(false)
  })

  it('rejects http except for local hosts', () => {
    expect(matchesNetwork('network:api.acme.dev', 'http://api.acme.dev/')).toBe(false)
    expect(matchesNetwork('network:*', 'http://example.com/')).toBe(false)
    expect(matchesNetwork('network:127.0.0.1', 'http://127.0.0.1:11999/v1')).toBe(true)
    expect(matchesNetwork('network:localhost', 'http://localhost/')).toBe(true)
  })

  it('rejects other schemes, credentials and garbage', () => {
    expect(matchesNetwork('network:*', 'ftp://example.com/')).toBe(false)
    expect(matchesNetwork('network:*', 'file:///etc/passwd')).toBe(false)
    expect(matchesNetwork('network:*', 'https://user:pw@example.com/')).toBe(false)
    expect(matchesNetwork('network:*', 'not a url')).toBe(false)
    expect(matchesNetwork('tools', 'https://example.com/')).toBe(false)
  })
})

describe('diffPermissions', () => {
  it('lists what an update adds and removes, ignoring order', () => {
    expect(
      diffPermissions(
        ['tools', 'network:a.dev', 'ui:notify'],
        ['ui:notify', 'network:b.dev', 'tools']
      )
    ).toEqual({ added: ['network:b.dev'], removed: ['network:a.dev'] })
    expect(diffPermissions(['tools'], ['tools'])).toEqual({
      added: [],
      removed: [],
    })
  })
})
