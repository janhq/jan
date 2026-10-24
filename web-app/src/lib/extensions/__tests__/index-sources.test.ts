import { describe, expect, it } from 'vitest'
import { latestVersion, validateSource } from '../index-sources'

const KEY = 'A'.repeat(43) + '='

describe('validateSource', () => {
  it('accepts an https URL with a name', () => {
    expect(
      validateSource({ url: 'https://ext.example.com/index.json', name: 'Ex' })
    ).toEqual({})
  })

  it('accepts a 32-byte base64 public key', () => {
    expect(
      validateSource({ url: 'https://a.b/i.json', name: 'Ex', publicKey: KEY })
    ).toEqual({})
  })

  it.each([
    ['http://ext.example.com/index.json', 'notHttps'],
    ['http://localhost/index.json', 'notHttps'],
    ['file:///etc/index.json', 'notHttps'],
    ['not a url', 'invalidUrl'],
    ['', 'invalidUrl'],
    ['https://user:pw@ext.example.com/index.json', 'credentials'],
  ])('rejects %s', (url, code) => {
    expect(validateSource({ url, name: 'Ex' }).url).toBe(code)
  })

  it('requires a name', () => {
    expect(validateSource({ url: 'https://a.b/i.json', name: '  ' }).name).toBe(
      'required'
    )
  })

  it.each(['abc', 'A'.repeat(44), '!'.repeat(43) + '='])(
    'rejects the public key %s',
    (publicKey) => {
      expect(
        validateSource({ url: 'https://a.b/i.json', name: 'Ex', publicKey })
          .publicKey
      ).toBe('invalidKey')
    }
  )

  it('treats a blank public key as none', () => {
    expect(
      validateSource({ url: 'https://a.b/i.json', name: 'Ex', publicKey: ' ' })
    ).toEqual({})
  })
})

const v = (version: string) => ({
  version,
  tarball: `https://a.b/${version}.tgz`,
  integrity: 'sha512-x',
  apiVersion: '^1.0.0',
  permissions: [],
})

describe('latestVersion', () => {
  it('picks the highest version, numerically per part', () => {
    expect(latestVersion([v('0.9.0'), v('0.10.0'), v('0.2.1')])?.version).toBe(
      '0.10.0'
    )
  })

  it('ranks a release above its prerelease', () => {
    expect(latestVersion([v('1.0.0'), v('1.0.0-beta.1')])?.version).toBe(
      '1.0.0'
    )
  })

  it('is undefined for no versions', () => {
    expect(latestVersion([])).toBeUndefined()
  })
})
