import { renderHook, act } from '@testing-library/react'
import { useClipboard } from './index'

// Mock the navigator.clipboard
const mockClipboard = {
  writeText: jest.fn(() => Promise.resolve()),
}
Object.assign(navigator, { clipboard: mockClipboard })

describe('@joi/hooks/useClipboard', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    jest.spyOn(window, 'setTimeout')
    jest.spyOn(window, 'clearTimeout')
    mockClipboard.writeText.mockClear()
  })

  afterEach(() => {
    jest.useRealTimers()
    jest.clearAllMocks()
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

  it('should set error if clipboard write fails', async () => {
    mockClipboard.writeText.mockRejectedValueOnce(
      new Error('Clipboard write failed')
    )

    const { result } = renderHook(() => useClipboard())

    await act(async () => {
      result.current.copy('Test text')
    })

    expect(result.current.error).toBeInstanceOf(Error)
    expect(result.current.error?.message).toBe('Clipboard write failed')
  })

  it('should set error if clipboard is not supported', async () => {
    const originalClipboard = navigator.clipboard
    // @ts-ignore
    delete navigator.clipboard

    const { result } = renderHook(() => useClipboard())

    await act(async () => {
      result.current.copy('Test text')
    })

    expect(result.current.error).toBeInstanceOf(Error)
    expect(result.current.error?.message).toBe(
      'useClipboard: navigator.clipboard is not supported'
    )

    // Restore clipboard support
    Object.assign(navigator, { clipboard: originalClipboard })
  })

  it('should reset copied state after timeout', async () => {
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

  it('should reset state when reset is called', async () => {
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
})
