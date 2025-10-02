import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { usePrompt } from '../usePrompt'

describe('usePrompt', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should initialize with empty prompt', () => {
    const { result } = renderHook(() => usePrompt())
    
    expect(result.current.prompt).toBe('')
    expect(typeof result.current.setPrompt).toBe('function')
  })

  it('should update prompt', () => {
    const { result } = renderHook(() => usePrompt())
    
    act(() => {
      result.current.setPrompt('Hello, world!')
    })
    
    expect(result.current.prompt).toBe('Hello, world!')
  })

  it('should clear prompt', () => {
    const { result } = renderHook(() => usePrompt())
    
    act(() => {
      result.current.setPrompt('Some text')
    })
    
    expect(result.current.prompt).toBe('Some text')
    
    act(() => {
      result.current.setPrompt('')
    })
    
    expect(result.current.prompt).toBe('')
  })

  it('should handle multiple prompt updates', () => {
    const { result } = renderHook(() => usePrompt())
    
    act(() => {
      result.current.setPrompt('First')
    })
    
    expect(result.current.prompt).toBe('First')
    
    act(() => {
      result.current.setPrompt('Second')
    })
    
    expect(result.current.prompt).toBe('Second')
    
    act(() => {
      result.current.setPrompt('Third')
    })
    
    expect(result.current.prompt).toBe('Third')
  })

  it('should handle special characters in prompt', () => {
    const { result } = renderHook(() => usePrompt())
    
    const specialText = 'Hello! @#$%^&*()_+{}|:"<>?[]\\;\',./'
    
    act(() => {
      result.current.setPrompt(specialText)
    })
    
    expect(result.current.prompt).toBe(specialText)
  })

  it('should handle multiline prompts', () => {
    const { result } = renderHook(() => usePrompt())
    
    const multilineText = 'Line 1\nLine 2\nLine 3'
    
    act(() => {
      result.current.setPrompt(multilineText)
    })
    
    expect(result.current.prompt).toBe(multilineText)
  })

  it('should handle very long prompts', () => {
    const { result } = renderHook(() => usePrompt())
    
    const longText = 'A'.repeat(10000)
    
    act(() => {
      result.current.setPrompt(longText)
    })
    
    expect(result.current.prompt).toBe(longText)
    expect(result.current.prompt.length).toBe(10000)
  })
})
