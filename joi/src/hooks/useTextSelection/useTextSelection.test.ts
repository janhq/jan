import { renderHook, act } from '@testing-library/react'
import { useTextSelection } from './index'

describe('@joi/hooks/useTextSelection', () => {
  let mockSelection: Selection

  beforeEach(() => {
    mockSelection = {
      toString: jest.fn(),
      removeAllRanges: jest.fn(),
      addRange: jest.fn(),
    } as unknown as Selection

    jest.spyOn(document, 'getSelection').mockReturnValue(mockSelection)
    jest.spyOn(document, 'addEventListener')
    jest.spyOn(document, 'removeEventListener')
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('should return the initial selection', () => {
    const { result } = renderHook(() => useTextSelection())
    expect(result.current).toBe(mockSelection)
  })

  it('should add and remove event listener', () => {
    const { unmount } = renderHook(() => useTextSelection())

    expect(document.addEventListener).toHaveBeenCalledWith(
      'selectionchange',
      expect.any(Function)
    )

    unmount()

    expect(document.removeEventListener).toHaveBeenCalledWith(
      'selectionchange',
      expect.any(Function)
    )
  })

  it('should update selection when selectionchange event is triggered', () => {
    const { result } = renderHook(() => useTextSelection())

    const newMockSelection = { toString: jest.fn() } as unknown as Selection
    jest.spyOn(document, 'getSelection').mockReturnValue(newMockSelection)

    act(() => {
      document.dispatchEvent(new Event('selectionchange'))
    })

    expect(result.current).toBe(newMockSelection)
  })
})
