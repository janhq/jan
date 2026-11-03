import { renderHook, act } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useHomeScope } from '../useHomeScope'

describe('home draft scope', () => {
  it('keeps project with route-local lifetime', () => {
    const first = renderHook(() => useHomeScope())
    act(() => {
      first.result.current.setProject({ id: 'project', name: 'Project', updated_at: 1, assistantId: 'assistant' })
    })
    expect(first.result.current.project?.assistantId).toBe('assistant')
    first.unmount()
    const next = renderHook(() => useHomeScope())
    expect(next.result.current.project).toBeNull()
  })
})
