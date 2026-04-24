import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useSidebarResize } from '../use-sidebar-resize'

describe('useSidebarResize', () => {
  const defaultProps = {
    currentWidth: '16rem',
    onResize: vi.fn(),
    onToggle: vi.fn(),
  }

  it('should return dragRef, isDragging, and handleMouseDown', () => {
    const { result } = renderHook(() => useSidebarResize(defaultProps))

    expect(result.current.dragRef).toBeDefined()
    expect(result.current.isDragging).toBeDefined()
    expect(result.current.isDragging.current).toBe(false)
    expect(typeof result.current.handleMouseDown).toBe('function')
  })

  it('should call onToggle on click (mousedown + mouseup without drag)', () => {
    const onToggle = vi.fn()
    renderHook(() =>
      useSidebarResize({ ...defaultProps, onToggle })
    )

    // Simulate mousedown then immediate mouseup (no movement = click)
    const mouseDownEvent = new MouseEvent('mousedown', {
      clientX: 200,
      bubbles: true,
    })
    // We need to trigger handleMouseDown via the hook, but since it's a React.MouseEvent handler,
    // let's simulate via document events after setting isInteractingWithRail
    // Instead, call handleMouseDown directly
    const { result } = renderHook(() =>
      useSidebarResize({ ...defaultProps, onToggle })
    )

    act(() => {
      // Simulate the mousedown handler
      result.current.handleMouseDown({
        clientX: 200,
        preventDefault: vi.fn(),
      } as any)
    })

    // Simulate mouseup without drag (delta < 5px)
    act(() => {
      document.dispatchEvent(new MouseEvent('mouseup', { clientX: 200 }))
    })

    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  it('should not call onToggle when enableToggle is false', () => {
    const onToggle = vi.fn()
    const { result } = renderHook(() =>
      useSidebarResize({ ...defaultProps, onToggle, enableToggle: false })
    )

    act(() => {
      result.current.handleMouseDown({
        clientX: 200,
        preventDefault: vi.fn(),
      } as any)
    })

    act(() => {
      document.dispatchEvent(new MouseEvent('mouseup', { clientX: 200 }))
    })

    expect(onToggle).not.toHaveBeenCalled()
  })

  it('should accept enableDrag false option', () => {
    const { result } = renderHook(() =>
      useSidebarResize({
        ...defaultProps,
        enableDrag: false,
      })
    )
    expect(result.current.handleMouseDown).toBeDefined()
  })

  it('should resize on drag with right direction', () => {
    const onResize = vi.fn()
    const { result } = renderHook(() =>
      useSidebarResize({
        ...defaultProps,
        onResize,
        direction: 'right',
        minResizeWidth: '14rem',
        maxResizeWidth: '24rem',
      })
    )

    act(() => {
      result.current.handleMouseDown({
        clientX: 256, // 16rem * 16 = 256px
        preventDefault: vi.fn(),
      } as any)
    })

    // Move mouse right by more than 5px to trigger drag
    act(() => {
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: 300 }))
    })

    expect(onResize).toHaveBeenCalled()
  })

  it('should clamp width to maxResizeWidth', () => {
    const onResize = vi.fn()
    const { result } = renderHook(() =>
      useSidebarResize({
        ...defaultProps,
        onResize,
        direction: 'right',
        minResizeWidth: '14rem',
        maxResizeWidth: '24rem',
      })
    )

    act(() => {
      result.current.handleMouseDown({
        clientX: 256,
        preventDefault: vi.fn(),
      } as any)
    })

    // Move to a very large x value (beyond max)
    act(() => {
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: 500 }))
    })

    // Should be clamped to max (24rem = 384px, formatted as 24.0rem for right direction)
    expect(onResize).toHaveBeenCalled()
    const lastCall = onResize.mock.calls[onResize.mock.calls.length - 1][0]
    // The value should not exceed 24.0rem
    expect(parseFloat(lastCall)).toBeLessThanOrEqual(24.0)
  })

  it('should set isDraggingRail when drag starts', () => {
    const setIsDraggingRail = vi.fn()
    const { result } = renderHook(() =>
      useSidebarResize({
        ...defaultProps,
        setIsDraggingRail,
      })
    )

    act(() => {
      result.current.handleMouseDown({
        clientX: 200,
        preventDefault: vi.fn(),
      } as any)
    })

    act(() => {
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: 210 }))
    })

    expect(setIsDraggingRail).toHaveBeenCalledWith(true)
  })

  it('should reset isDraggingRail on mouseup', () => {
    const setIsDraggingRail = vi.fn()
    const { result } = renderHook(() =>
      useSidebarResize({
        ...defaultProps,
        setIsDraggingRail,
      })
    )

    act(() => {
      result.current.handleMouseDown({
        clientX: 200,
        preventDefault: vi.fn(),
      } as any)
    })

    act(() => {
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: 210 }))
    })

    act(() => {
      document.dispatchEvent(new MouseEvent('mouseup', { clientX: 210 }))
    })

    expect(setIsDraggingRail).toHaveBeenCalledWith(false)
  })

  it('should handle left direction resize', () => {
    const onResize = vi.fn()
    Object.defineProperty(window, 'innerWidth', { value: 1024, writable: true })

    const { result } = renderHook(() =>
      useSidebarResize({
        ...defaultProps,
        onResize,
        direction: 'left',
        minResizeWidth: '14rem',
        maxResizeWidth: '24rem',
      })
    )

    act(() => {
      result.current.handleMouseDown({
        clientX: 800,
        preventDefault: vi.fn(),
      } as any)
    })

    act(() => {
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: 750 }))
    })

    expect(onResize).toHaveBeenCalled()
  })

  it('should handle px width units', () => {
    const onResize = vi.fn()
    const { result } = renderHook(() =>
      useSidebarResize({
        ...defaultProps,
        currentWidth: '256px',
        onResize,
        minResizeWidth: '224px',
        maxResizeWidth: '384px',
      })
    )

    act(() => {
      result.current.handleMouseDown({
        clientX: 256,
        preventDefault: vi.fn(),
      } as any)
    })

    act(() => {
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: 300 }))
    })

    expect(onResize).toHaveBeenCalled()
    const lastCall = onResize.mock.calls[onResize.mock.calls.length - 1][0]
    expect(lastCall).toMatch(/px$/)
  })

  it('should clean up event listeners on unmount', () => {
    const removeEventListenerSpy = vi.spyOn(document, 'removeEventListener')

    const { unmount } = renderHook(() => useSidebarResize(defaultProps))

    unmount()

    expect(removeEventListenerSpy).toHaveBeenCalledWith(
      'mousemove',
      expect.any(Function)
    )
    expect(removeEventListenerSpy).toHaveBeenCalledWith(
      'mouseup',
      expect.any(Function)
    )

    removeEventListenerSpy.mockRestore()
  })
})
