import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useReleaseNotes } from '../useReleaseNotes'

// Mock fetch
const mockFetch = vi.fn()
global.fetch = mockFetch

describe('useReleaseNotes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset store state to defaults
    useReleaseNotes.setState({
      release: null,
      loading: false,
      error: null,
    })
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  it('should initialize with default values', () => {
    const { result } = renderHook(() => useReleaseNotes())

    expect(result.current.release).toBe(null)
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBe(null)
    expect(typeof result.current.fetchLatestRelease).toBe('function')
  })

  describe('fetchLatestRelease', () => {
    it('should fetch stable release when includeBeta is false', async () => {
      const mockReleases = [
        {
          tag_name: 'v2.0.0-beta.1',
          prerelease: true,
          draft: false,
          body: 'Beta release notes',
        },
        {
          tag_name: 'v1.5.0',
          prerelease: false,
          draft: false,
          body: 'Stable release notes',
        },
        {
          tag_name: 'v1.4.0',
          prerelease: false,
          draft: false,
          body: 'Previous stable release',
        },
      ]

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockReleases,
      })

      const { result } = renderHook(() => useReleaseNotes())

      await act(async () => {
        await result.current.fetchLatestRelease(false)
      })

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.github.com/repos/janhq/jan/releases'
      )
      expect(result.current.loading).toBe(false)
      expect(result.current.error).toBe(null)
      expect(result.current.release).toEqual({
        tag_name: 'v1.5.0',
        prerelease: false,
        draft: false,
        body: 'Stable release notes',
      })
    })

    it('should fetch beta release when includeBeta is true', async () => {
      const mockReleases = [
        {
          tag_name: 'v2.0.0-beta.1',
          prerelease: true,
          draft: false,
          body: 'Beta release notes',
        },
        {
          tag_name: 'v1.5.0',
          prerelease: false,
          draft: false,
          body: 'Stable release notes',
        },
      ]

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockReleases,
      })

      const { result } = renderHook(() => useReleaseNotes())

      await act(async () => {
        await result.current.fetchLatestRelease(true)
      })

      expect(result.current.release).toEqual({
        tag_name: 'v2.0.0-beta.1',
        prerelease: true,
        draft: false,
        body: 'Beta release notes',
      })
    })

    it('should fallback to stable release when includeBeta is true but no beta exists', async () => {
      const mockReleases = [
        {
          tag_name: 'v1.5.0',
          prerelease: false,
          draft: false,
          body: 'Stable release notes',
        },
        {
          tag_name: 'v1.4.0',
          prerelease: false,
          draft: false,
          body: 'Previous stable release',
        },
      ]

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockReleases,
      })

      const { result } = renderHook(() => useReleaseNotes())

      await act(async () => {
        await result.current.fetchLatestRelease(true)
      })

      expect(result.current.release).toEqual({
        tag_name: 'v1.5.0',
        prerelease: false,
        draft: false,
        body: 'Stable release notes',
      })
    })

    it('should ignore draft releases', async () => {
      const mockReleases = [
        {
          tag_name: 'v2.0.0-draft',
          prerelease: false,
          draft: true,
          body: 'Draft release',
        },
        {
          tag_name: 'v1.5.0',
          prerelease: false,
          draft: false,
          body: 'Stable release notes',
        },
      ]

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockReleases,
      })

      const { result } = renderHook(() => useReleaseNotes())

      await act(async () => {
        await result.current.fetchLatestRelease(false)
      })

      expect(result.current.release).toEqual({
        tag_name: 'v1.5.0',
        prerelease: false,
        draft: false,
        body: 'Stable release notes',
      })
    })

    it('should set loading state during fetch', async () => {
      const { result } = renderHook(() => useReleaseNotes())

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      })

      await act(async () => {
        await result.current.fetchLatestRelease(false)
      })

      expect(result.current.loading).toBe(false)
      expect(result.current.error).toBe(null)
    })

    it('should handle fetch errors', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'))

      const { result } = renderHook(() => useReleaseNotes())

      await act(async () => {
        await result.current.fetchLatestRelease(false)
      })

      expect(result.current.loading).toBe(false)
      expect(result.current.error).toBe('Network error')
      expect(result.current.release).toBe(null)
    })

    it('should handle HTTP errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
      })

      const { result } = renderHook(() => useReleaseNotes())

      await act(async () => {
        await result.current.fetchLatestRelease(false)
      })

      expect(result.current.loading).toBe(false)
      expect(result.current.error).toBe('Failed to fetch releases')
      expect(result.current.release).toBe(null)
    })

    it('should handle empty releases array', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      })

      const { result } = renderHook(() => useReleaseNotes())

      await act(async () => {
        await result.current.fetchLatestRelease(false)
      })

      expect(result.current.loading).toBe(false)
      expect(result.current.error).toBe(null)
      expect(result.current.release).toBe(undefined)
    })

    it('should clear previous error on new fetch', async () => {
      const { result } = renderHook(() => useReleaseNotes())

      // First request fails
      mockFetch.mockRejectedValueOnce(new Error('First error'))

      await act(async () => {
        await result.current.fetchLatestRelease(false)
      })

      expect(result.current.error).toBe('First error')

      // Second request succeeds
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            tag_name: 'v1.0.0',
            prerelease: false,
            draft: false,
            body: 'Release notes',
          },
        ],
      })

      await act(async () => {
        await result.current.fetchLatestRelease(false)
      })

      expect(result.current.error).toBe(null)
      expect(result.current.release).toEqual({
        tag_name: 'v1.0.0',
        prerelease: false,
        draft: false,
        body: 'Release notes',
      })
    })

    it('should handle releases with additional properties', async () => {
      const mockReleases = [
        {
          tag_name: 'v1.5.0',
          prerelease: false,
          draft: false,
          body: 'Release notes',
          published_at: '2024-01-01T00:00:00Z',
          html_url: 'https://github.com/janhq/jan/releases/tag/v1.5.0',
          assets: [],
        },
      ]

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockReleases,
      })

      const { result } = renderHook(() => useReleaseNotes())

      await act(async () => {
        await result.current.fetchLatestRelease(false)
      })

      expect(result.current.release).toEqual(mockReleases[0])
    })
  })

  describe('state management', () => {
    it('should maintain state across multiple hook instances', () => {
      const { result: result1 } = renderHook(() => useReleaseNotes())
      const { result: result2 } = renderHook(() => useReleaseNotes())

      expect(result1.current.release).toBe(result2.current.release)
      expect(result1.current.loading).toBe(result2.current.loading)
      expect(result1.current.error).toBe(result2.current.error)
    })
  })

  describe('multiple requests', () => {
    it('should handle sequential requests', async () => {
      const mockReleases = [
        {
          tag_name: 'v1.0.0',
          prerelease: false,
          draft: false,
          body: 'Release notes',
        },
      ]

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => mockReleases,
      })

      const { result } = renderHook(() => useReleaseNotes())

      // First request
      await act(async () => {
        await result.current.fetchLatestRelease(false)
      })

      expect(result.current.loading).toBe(false)
      expect(result.current.error).toBe(null)

      // Second request
      await act(async () => {
        await result.current.fetchLatestRelease(true)
      })

      expect(mockFetch).toHaveBeenCalledTimes(2)
      expect(result.current.loading).toBe(false)
      expect(result.current.error).toBe(null)
    })
  })
})
