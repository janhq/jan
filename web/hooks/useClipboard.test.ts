import { renderHook, act } from '@testing-library/react'
import { useClipboard } from './useClipboard'

describe('useClipboard', () => {
  let originalClipboard: any

  beforeAll(() => {
    originalClipboard = { ...global.navigator.clipboard }
    const mockClipboard = {
      writeText: jest.fn(() => Promise.resolve()),
    }
    // @ts-ignore
    global.navigator.clipboard = mockClipboard
  })

  afterAll(() => {
    // @ts-ignore
    global.navigator.clipboard = originalClipboard
  })

  beforeEach(() => {
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.clearAllTimers()
    jest.useRealTimers()
  })

  it('should copy text to clipboard', async () => {
    const { result } = renderHook(() => useClipboard())

    await act(async () => {
      result.current.copy('Test text')
    })

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('Test text')
    expect(result.current.copied).toBe(true)
    expect(result.current.error).toBe(null)
  })

  it('should set copied to false after timeout', async () => {
    const { result } = renderHook(() => useClipboard({ timeout: 1000 }))

    await act(async () => {
      result.current.copy('Test text')
    })

    expect(result.current.copied).toBe(true)

    act(() => {
      jest.advanceTimersByTime(1000)
    })

    expect(result.current.copied).toBe(false)
  })

  it('should handle clipboard errors', async () => {
    const mockError = new Error('Clipboard error')
    // @ts-ignore
    navigator.clipboard.writeText.mockRejectedValueOnce(mockError)

    const { result } = renderHook(() => useClipboard())

    await act(async () => {
      result.current.copy('Test text')
    })

    expect(result.current.error).toEqual(mockError)
    expect(result.current.copied).toBe(false)
  })

  it('should reset state', async () => {
    const { result } = renderHook(() => useClipboard())

    await act(async () => {
      result.current.copy('Test text')
    })

    expect(result.current.copied).toBe(true)

    act(() => {
      result.current.reset()
    })

    expect(result.current.copied).toBe(false)
    expect(result.current.error).toBe(null)
  })

  it('should handle missing clipboard API', () => {
    // @ts-ignore
    delete global.navigator.clipboard

    const { result } = renderHook(() => useClipboard())

    act(() => {
      result.current.copy('Test text')
    })

    expect(result.current.error).toEqual(
      new Error('useClipboard: navigator.clipboard is not supported')
    )
    expect(result.current.copied).toBe(false)
  })
})
