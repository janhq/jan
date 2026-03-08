import { renderHook } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useClickOutside } from '../useClickOutside'

describe('useClickOutside', () => {
  let mockHandler: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockHandler = vi.fn()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('should return a ref', () => {
    const { result } = renderHook(() => useClickOutside(mockHandler))
    
    expect(result.current.current).toBeNull()
    expect(result.current).toHaveProperty('current')
  })

  it('should call handler when clicking outside element', () => {
    const { result } = renderHook(() => useClickOutside(mockHandler))
    
    // Create a mock element and attach it to the ref
    const mockElement = document.createElement('div')
    result.current.current = mockElement
    
    // Create a click event outside the element
    const outsideElement = document.createElement('div')
    document.body.appendChild(outsideElement)
    
    const event = new MouseEvent('mousedown', { bubbles: true })
    Object.defineProperty(event, 'target', { value: outsideElement })
    
    document.dispatchEvent(event)
    
    expect(mockHandler).toHaveBeenCalledTimes(1)
    
    // Cleanup
    document.body.removeChild(outsideElement)
  })

  it('should not call handler when clicking inside element', () => {
    const { result } = renderHook(() => useClickOutside(mockHandler))
    
    // Create a mock element and attach it to the ref
    const mockElement = document.createElement('div')
    const childElement = document.createElement('span')
    mockElement.appendChild(childElement)
    result.current.current = mockElement
    
    const event = new MouseEvent('mousedown', { bubbles: true })
    Object.defineProperty(event, 'target', { value: childElement })
    
    document.dispatchEvent(event)
    
    expect(mockHandler).not.toHaveBeenCalled()
  })

  it('should use custom events when provided', () => {
    const customEvents = ['click', 'keydown']
    const { result } = renderHook(() => useClickOutside(mockHandler, customEvents))
    
    const mockElement = document.createElement('div')
    result.current.current = mockElement
    
    const outsideElement = document.createElement('div')
    document.body.appendChild(outsideElement)
    
    // Test custom event
    const clickEvent = new MouseEvent('click', { bubbles: true })
    Object.defineProperty(clickEvent, 'target', { value: outsideElement })
    
    document.dispatchEvent(clickEvent)
    
    expect(mockHandler).toHaveBeenCalledTimes(1)
    
    // Test that default events don't trigger
    const mousedownEvent = new MouseEvent('mousedown', { bubbles: true })
    Object.defineProperty(mousedownEvent, 'target', { value: outsideElement })
    
    document.dispatchEvent(mousedownEvent)
    
    // Should still be 1 since mousedown is not in custom events
    expect(mockHandler).toHaveBeenCalledTimes(1)
    
    // Cleanup
    document.body.removeChild(outsideElement)
  })

  it('should work with multiple nodes', () => {
    const node1 = document.createElement('div')
    const node2 = document.createElement('div')
    const nodes = [node1, node2]
    
    renderHook(() => useClickOutside(mockHandler, null, nodes))
    
    const outsideElement = document.createElement('div')
    document.body.appendChild(outsideElement)
    
    const event = new MouseEvent('mousedown', { bubbles: true })
    Object.defineProperty(event, 'target', { value: outsideElement })
    Object.defineProperty(event, 'composedPath', { 
      value: () => [outsideElement, document.body, document.documentElement] 
    })
    
    document.dispatchEvent(event)
    
    expect(mockHandler).toHaveBeenCalledTimes(1)
    
    // Cleanup
    document.body.removeChild(outsideElement)
  })

  it('should not call handler when clicking inside any of the provided nodes', () => {
    const node1 = document.createElement('div')
    const node2 = document.createElement('div')
    const nodes = [node1, node2]
    
    renderHook(() => useClickOutside(mockHandler, null, nodes))
    
    const event = new MouseEvent('mousedown', { bubbles: true })
    Object.defineProperty(event, 'target', { value: node1 })
    Object.defineProperty(event, 'composedPath', { 
      value: () => [node1, document.body, document.documentElement] 
    })
    
    document.dispatchEvent(event)
    
    expect(mockHandler).not.toHaveBeenCalled()
  })

  it('should ignore clicks on elements with data-ignore-outside-clicks attribute', () => {
    const node1 = document.createElement('div')
    const nodes = [node1]
    
    renderHook(() => useClickOutside(mockHandler, null, nodes))
    
    const outsideElement = document.createElement('div')
    outsideElement.setAttribute('data-ignore-outside-clicks', 'true')
    document.body.appendChild(outsideElement)
    
    const event = new MouseEvent('mousedown', { bubbles: true })
    Object.defineProperty(event, 'target', { value: outsideElement })
    Object.defineProperty(event, 'composedPath', { 
      value: () => [outsideElement, document.body, document.documentElement] 
    })
    
    document.dispatchEvent(event)
    
    expect(mockHandler).not.toHaveBeenCalled()
    
    // Cleanup
    document.body.removeChild(outsideElement)
  })

  it('should cleanup event listeners on unmount', () => {
    const addEventListenerSpy = vi.spyOn(document, 'addEventListener')
    const removeEventListenerSpy = vi.spyOn(document, 'removeEventListener')
    
    const { unmount } = renderHook(() => useClickOutside(mockHandler))
    
    expect(addEventListenerSpy).toHaveBeenCalledTimes(2) // mousedown and touchstart
    
    unmount()
    
    expect(removeEventListenerSpy).toHaveBeenCalledTimes(2)
    
    addEventListenerSpy.mockRestore()
    removeEventListenerSpy.mockRestore()
  })
})
