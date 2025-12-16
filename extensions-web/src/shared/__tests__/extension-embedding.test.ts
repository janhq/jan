import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  isInIframe,
  isEmbedded,
  getExtensionIdFromUrl,
  getExtensionIdFromStorage,
  getExtensionEmbeddingInfo,
  buildEmbeddedUrl,
} from '../extension-embedding'

describe('extension-embedding', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(),
      setItem: vi.fn(),
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('isInIframe', () => {
    it('returns true when accessing window.top throws (cross-origin)', () => {
      const mockWindow = {
        get top(): never {
          throw new Error('cross-origin')
        },
      }
      vi.stubGlobal('window', mockWindow)
      expect(isInIframe()).toBe(true)
    })
  })

  describe('getExtensionIdFromUrl', () => {
    it('returns null when no extensionId param', () => {
      vi.stubGlobal('window', { location: { search: '' } })
      expect(getExtensionIdFromUrl()).toBeNull()
    })

    it('returns extensionId from URL params', () => {
      vi.stubGlobal('window', { location: { search: '?extensionId=test123' } })
      expect(getExtensionIdFromUrl()).toBe('test123')
    })

    it('trims whitespace from extensionId', () => {
      vi.stubGlobal('window', { location: { search: '?extensionId=%20abc%20' } })
      expect(getExtensionIdFromUrl()).toBe('abc')
    })

    it('returns null for empty extensionId', () => {
      vi.stubGlobal('window', { location: { search: '?extensionId=' } })
      expect(getExtensionIdFromUrl()).toBeNull()
    })
  })

  describe('isEmbedded', () => {
    it('returns true when embedded=true in URL', () => {
      const mockWindow = { location: { search: '?embedded=true' } }
      Object.defineProperty(mockWindow, 'top', { value: mockWindow })
      vi.stubGlobal('window', mockWindow)
      expect(isEmbedded()).toBe(true)
    })

    it('returns true when in iframe (different top)', () => {
      vi.stubGlobal('window', { top: {}, location: { search: '' } })
      expect(isEmbedded()).toBe(true)
    })
  })

  describe('getExtensionIdFromStorage', () => {
    it('returns null when localStorage is empty', () => {
      vi.mocked(localStorage.getItem).mockReturnValue(null)
      expect(getExtensionIdFromStorage()).toBeNull()
    })

    it('returns extensionId from localStorage', () => {
      vi.mocked(localStorage.getItem).mockReturnValue(
        JSON.stringify({ state: { browserExtensionId: 'stored123' } })
      )
      expect(getExtensionIdFromStorage()).toBe('stored123')
    })

    it('returns null for invalid JSON', () => {
      vi.mocked(localStorage.getItem).mockReturnValue('invalid json')
      expect(getExtensionIdFromStorage()).toBeNull()
    })

    it('returns null for empty browserExtensionId', () => {
      vi.mocked(localStorage.getItem).mockReturnValue(
        JSON.stringify({ state: { browserExtensionId: '' } })
      )
      expect(getExtensionIdFromStorage()).toBeNull()
    })
  })

  describe('buildEmbeddedUrl', () => {
    it('adds embedded=true param', () => {
      const url = buildEmbeddedUrl('https://example.com')
      expect(url).toBe('https://example.com/?embedded=true')
    })

    it('adds extensionId param when provided', () => {
      const url = buildEmbeddedUrl('https://example.com', 'ext123')
      expect(url).toContain('embedded=true')
      expect(url).toContain('extensionId=ext123')
    })

    it('adds additional params', () => {
      const url = buildEmbeddedUrl('https://example.com', undefined, { foo: 'bar' })
      expect(url).toContain('embedded=true')
      expect(url).toContain('foo=bar')
    })
  })

  describe('getExtensionEmbeddingInfo', () => {
    it('returns complete embedding info', () => {
      const mockWindow = { location: { search: '' } }
      Object.defineProperty(mockWindow, 'top', { value: mockWindow })
      vi.stubGlobal('window', mockWindow)
      vi.mocked(localStorage.getItem).mockReturnValue(null)

      const info = getExtensionEmbeddingInfo()
      expect(info).toHaveProperty('isInIframe')
      expect(info).toHaveProperty('isEmbedded')
      expect(info).toHaveProperty('urlExtensionId')
      expect(info).toHaveProperty('extensionId')
    })
  })
})
