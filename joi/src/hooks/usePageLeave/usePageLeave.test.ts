import { renderHook } from '@testing-library/react'
import { fireEvent } from '@testing-library/react'
import { usePageLeave } from './index'

describe('@joi/hooks/usePageLeave', () => {
  it('should call onPageLeave when mouse leaves the document', () => {
    const onPageLeaveMock = jest.fn()
    const { result } = renderHook(() => usePageLeave(onPageLeaveMock))

    fireEvent.mouseLeave(document.documentElement)

    expect(onPageLeaveMock).toHaveBeenCalledTimes(1)
  })

  it('should remove event listener on unmount', () => {
    const onPageLeaveMock = jest.fn()
    const removeEventListenerSpy = jest.spyOn(
      document.documentElement,
      'removeEventListener'
    )

    const { unmount } = renderHook(() => usePageLeave(onPageLeaveMock))

    unmount()

    expect(removeEventListenerSpy).toHaveBeenCalledWith(
      'mouseleave',
      expect.any(Function)
    )
    removeEventListenerSpy.mockRestore()
  })
})
