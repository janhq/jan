import { describe, it, expect } from 'vitest'
import { classifyDownloadError } from '../downloadError'

describe('classifyDownloadError', () => {
  it.each([
    ['dns error: failed to lookup address information', 'dns'],
    ['tcp connect error: No such host is known. (os error 11001)', 'dns'],
    ['tcp connect error: connection refused (os error 10061)', 'refused'],
    [
      // Captured from reqwest on Windows against a closed local port.
      'Error: error sending request for url (http://127.0.0.1:55420/model.gguf): client error (Connect): tcp connect error: No connection could be made because the target machine actively refused it. (os error 10061)',
      'refused',
    ],
    ['operation timed out', 'timeout'],
    ['A connection attempt failed (os error 10060)', 'timeout'],
    ['invalid peer certificate: UnknownIssuer', 'tls'],
    ['error trying to connect: tls handshake eof', 'tls'],
    ['proxy connect error: tunnel error', 'proxy'],
  ] as const)('%s -> %s', (error, reason) => {
    expect(classifyDownloadError(error)).toBe(reason)
  })

  it('prefers the specific cause over the generic request wrapper', () => {
    expect(
      classifyDownloadError(
        'Error: error sending request for url (https://x): tcp connect error: connection refused (os error 10061)'
      )
    ).toBe('refused')
  })

  it('never reads the requested URL as a cause', () => {
    expect(
      classifyDownloadError(
        'Error: error sending request for url (https://huggingface.co/org/proxy-tls-timeout-model/resolve/main/m.gguf?download=true): client error (Connect): tcp connect error: connection refused (os error 10061)'
      )
    ).toBe('refused')
    expect(
      classifyDownloadError(
        'Error: error sending request for url (https://hf.co/proxy/connection-reset/m.gguf)'
      )
    ).toBe('unreachable')
  })

  it('falls back to a generic unreachable reason for a bare request failure', () => {
    expect(
      classifyDownloadError('Error: error sending request for url (https://x)')
    ).toBe('unreachable')
  })

  it('has no opinion on errors that are not network failures', () => {
    expect(classifyDownloadError('')).toBeUndefined()
    expect(classifyDownloadError('Error: No space left on device')).toBeUndefined()
  })
})
