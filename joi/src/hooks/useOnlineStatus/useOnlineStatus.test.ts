import { renderHook, act } from '@testing-library/react'
import { useOnlineStatus } from './index'

describe('useOnlineStatus', () => {
  beforeEach(() => {
    jest.spyOn(window, 'addEventListener')
    jest.spyOn(window, 'removeEventListener')
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('should initialize with the correct online status', () => {
    const { result } = renderHook(() => useOnlineStatus())
    expect(result.current.isOnline).toBe(navigator.onLine)
  })

  it('should set online status to true when the online event is triggered', () => {
    const { result } = renderHook(() => useOnlineStatus())

    act(() => {
      window.dispatchEvent(new Event('online'))
    })

    expect(result.current.isOnline).toBe(true)
  })

  it('should set online status to false when the offline event is triggered', () => {
    const { result } = renderHook(() => useOnlineStatus())

    act(() => {
      window.dispatchEvent(new Event('offline'))
    })

    expect(result.current.isOnline).toBe(false)
  })

  it('should register event listeners on mount and unregister on unmount', () => {
    const { unmount } = renderHook(() => useOnlineStatus())

    expect(window.addEventListener).toHaveBeenCalledWith(
      'online',
      expect.any(Function)
    )
    expect(window.addEventListener).toHaveBeenCalledWith(
      'offline',
      expect.any(Function)
    )

    unmount()

    expect(window.removeEventListener).toHaveBeenCalledWith(
      'online',
      expect.any(Function)
    )
    expect(window.removeEventListener).toHaveBeenCalledWith(
      'offline',
      expect.any(Function)
    )
  })
})
