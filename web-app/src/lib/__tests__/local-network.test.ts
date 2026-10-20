import { describe, expect, it } from 'vitest'
import { isLocalNetworkUrl, localNetworkHint } from '../local-network'

describe('isLocalNetworkUrl', () => {
  it.each([
    'http://10.1.0.211:11434/v1',
    'http://172.16.0.5/v1',
    'http://172.31.255.1/v1',
    'http://192.168.1.20:8080',
    'http://169.254.10.1',
    'http://hotrod.local:11434/v1',
  ])('is true for %s', (url) => {
    expect(isLocalNetworkUrl(url)).toBe(true)
  })

  it.each([
    'http://localhost:11434/v1',
    'http://127.0.0.1:1234',
    'http://172.15.0.1',
    'http://172.32.0.1',
    'http://192.169.1.1',
    'https://api.openai.com/v1',
    'not a url',
  ])('is false for %s', (url) => {
    expect(isLocalNetworkUrl(url)).toBe(false)
  })
})

describe('localNetworkHint', () => {
  it('names the macOS setting for a LAN host', () => {
    expect(localNetworkHint('http://10.1.0.211:11434/v1', true)).toMatch(
      /Local Network/
    )
  })

  it('is empty off macOS or for a host macOS does not gate', () => {
    expect(localNetworkHint('http://10.1.0.211:11434/v1', false)).toBe('')
    expect(localNetworkHint('http://localhost:11434/v1', true)).toBe('')
    expect(localNetworkHint('https://api.openai.com/v1', true)).toBe('')
  })
})
