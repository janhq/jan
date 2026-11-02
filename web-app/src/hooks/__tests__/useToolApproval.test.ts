import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useToolApproval } from '../useToolApproval'

// Mock constants
vi.mock('@/constants/localStorage', () => ({
  localStorageKey: {
    toolApproval: 'tool-approval-settings',
  },
}))

// Exercise the real persist middleware without touching disk or real settings.
const stored = vi.hoisted(() => new Map<string, string>())
vi.mock('@/lib/backendStorage', () => ({
  backendStorage: {
    getItem: vi.fn((key: string) => stored.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => stored.set(key, value)),
    removeItem: vi.fn((key: string) => stored.delete(key)),
  },
}))

describe('useToolApproval', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    stored.clear()
    // Reset store state to defaults
    useToolApproval.setState({
      approvedTools: {},
      approvedMCPTools: [],
      approvedServers: [],
      approvedToolsGlobal: [],
      allowAllMCPPermissions: false,
    })
  })

  it('should initialize with default values', () => {
    const { result } = renderHook(() => useToolApproval())

    expect(result.current.approvedTools).toEqual({})
    expect(result.current.approvedMCPTools).toEqual([])
    expect(result.current.approvedServers).toEqual([])
    expect(result.current.approvedToolsGlobal).toEqual([])
    expect(result.current.allowAllMCPPermissions).toBe(false)
    expect(typeof result.current.approveToolForThread).toBe('function')
    expect(typeof result.current.approveServer).toBe('function')
    expect(typeof result.current.approveToolEverywhere).toBe('function')
    expect(typeof result.current.isToolApproved).toBe('function')
    expect(typeof result.current.setAllowAllMCPPermissions).toBe('function')
  })

  describe('setAllowAllMCPPermissions', () => {
    it('should set allowAllMCPPermissions to true', () => {
      const { result } = renderHook(() => useToolApproval())

      act(() => {
        result.current.setAllowAllMCPPermissions(true)
      })

      expect(result.current.allowAllMCPPermissions).toBe(true)
    })

    it('should set allowAllMCPPermissions to false', () => {
      const { result } = renderHook(() => useToolApproval())

      act(() => {
        result.current.setAllowAllMCPPermissions(true)
      })

      expect(result.current.allowAllMCPPermissions).toBe(true)

      act(() => {
        result.current.setAllowAllMCPPermissions(false)
      })

      expect(result.current.allowAllMCPPermissions).toBe(false)
    })
  })

  describe('approveToolForThread', () => {
    it('should approve a tool for a thread', () => {
      const { result } = renderHook(() => useToolApproval())

      act(() => {
        result.current.approveToolForThread('thread-1', 'tool-a')
      })

      expect(result.current.approvedTools['thread-1']).toContain('tool-a')
    })

    it('should approve multiple tools for the same thread', () => {
      const { result } = renderHook(() => useToolApproval())

      act(() => {
        result.current.approveToolForThread('thread-1', 'tool-a')
        result.current.approveToolForThread('thread-1', 'tool-b')
        result.current.approveToolForThread('thread-1', 'tool-c')
      })

      expect(result.current.approvedTools['thread-1']).toEqual(['tool-a', 'tool-b', 'tool-c'])
    })

    it('should approve tools for different threads independently', () => {
      const { result } = renderHook(() => useToolApproval())

      act(() => {
        result.current.approveToolForThread('thread-1', 'tool-a')
        result.current.approveToolForThread('thread-2', 'tool-b')
        result.current.approveToolForThread('thread-3', 'tool-c')
      })

      expect(result.current.approvedTools['thread-1']).toEqual(['tool-a'])
      expect(result.current.approvedTools['thread-2']).toEqual(['tool-b'])
      expect(result.current.approvedTools['thread-3']).toEqual(['tool-c'])
    })

    it('should not duplicate tools when approving the same tool multiple times', () => {
      const { result } = renderHook(() => useToolApproval())

      act(() => {
        result.current.approveToolForThread('thread-1', 'tool-a')
        result.current.approveToolForThread('thread-1', 'tool-a')
        result.current.approveToolForThread('thread-1', 'tool-a')
      })

      expect(result.current.approvedTools['thread-1']).toEqual(['tool-a'])
    })
  })

  describe('isToolApproved', () => {
    it('should return false for non-approved tools', () => {
      const { result } = renderHook(() => useToolApproval())

      const isApproved = result.current.isToolApproved('thread-1', 'tool-a')
      expect(isApproved).toBe(false)
    })

    it('should return true for approved tools', () => {
      const { result } = renderHook(() => useToolApproval())

      act(() => {
        result.current.approveToolForThread('thread-1', 'tool-a')
      })

      const isApproved = result.current.isToolApproved('thread-1', 'tool-a')
      expect(isApproved).toBe(true)
    })

    it('should return false for tools approved for different threads', () => {
      const { result } = renderHook(() => useToolApproval())

      act(() => {
        result.current.approveToolForThread('thread-1', 'tool-a')
      })

      const isApproved = result.current.isToolApproved('thread-2', 'tool-a')
      expect(isApproved).toBe(false)
    })
  })

  describe('server-qualified thread grants', () => {
    it('matches the exact thread, server and tool, and deduplicates grants', () => {
      const approval = useToolApproval.getState()
      approval.approveToolForThread('thread-1', 'read_file', 'server-a')
      approval.approveToolForThread('thread-1', 'read_file', 'server-a')

      expect(useToolApproval.getState().approvedMCPTools).toEqual([
        { threadId: 'thread-1', serverName: 'server-a', toolName: 'read_file' },
      ])
      expect(approval.isToolApproved('thread-1', 'read_file', 'server-a')).toBe(true)
      expect(approval.isToolApproved('thread-1', 'read_file', 'server-b')).toBe(false)
      expect(approval.isToolApproved('thread-2', 'read_file', 'server-a')).toBe(false)
      expect(approval.isToolApproved('thread-1', 'write_file', 'server-a')).toBe(false)
      expect(approval.isToolApproved('thread-1', 'read_file')).toBe(false)
      expect(useToolApproval.getState().approvedTools).toEqual({})
    })

    it('does not interpret delimiter-like names as qualified identities', () => {
      const approval = useToolApproval.getState()
      approval.approveToolForThread('thread-1', 'b::c', 'a')
      approval.approveToolForThread('thread-1', 'a::b::c')
      expect(approval.isToolApproved('thread-1', 'c', 'a::b')).toBe(false)
      expect(approval.isToolApproved('thread-1', 'b::c', 'a')).toBe(true)
    })

    it('retains bare persisted thread/global grants only for no-server tools', () => {
      useToolApproval.setState({
        approvedTools: { 'thread-1': ['read_file'] },
        approvedToolsGlobal: ['write_file'],
      })
      const approval = useToolApproval.getState()
      expect(approval.isToolApproved('thread-1', 'read_file')).toBe(true)
      expect(approval.isToolApproved('thread-2', 'write_file')).toBe(true)
      expect(approval.isToolApproved('thread-1', 'read_file', 'server-a')).toBe(false)
      expect(approval.isToolApproved('thread-2', 'write_file', 'server-a')).toBe(false)
    })
  })

  describe('persistence', () => {
    it('rehydrates old grants without upgrading them to server trust', async () => {
      stored.set('tool-approval-settings', JSON.stringify({
        state: {
          approvedTools: { 'thread-1': ['read_file'] },
          approvedToolsGlobal: ['write_file'],
          approvedServers: ['trusted'],
          allowAllMCPPermissions: false,
        },
        version: 0,
      }))
      await useToolApproval.persist.rehydrate()
      const approval = useToolApproval.getState()
      expect(approval.approvedMCPTools).toEqual([])
      expect(approval.isToolApproved('thread-1', 'read_file')).toBe(true)
      expect(approval.isToolApproved('thread-2', 'write_file')).toBe(true)
      expect(approval.isToolApproved('thread-1', 'read_file', 'untrusted')).toBe(false)
      expect(approval.isToolApproved('thread-1', 'write_file', 'untrusted')).toBe(false)
      expect(approval.isToolApproved('thread-2', 'anything', 'trusted')).toBe(true)
      expect(approval.allowAllMCPPermissions).toBe(false)
    })

    it('persists qualified grants as structured identities and rehydrates them', async () => {
      useToolApproval.getState().approveToolForThread('thread-1', 'b::c', 'a')
      const persisted = stored.get('tool-approval-settings')!
      expect(JSON.parse(persisted).state.approvedMCPTools).toEqual([
        { threadId: 'thread-1', serverName: 'a', toolName: 'b::c' },
      ])
      useToolApproval.setState({ approvedMCPTools: [] })
      stored.set('tool-approval-settings', persisted)
      await useToolApproval.persist.rehydrate()
      const approval = useToolApproval.getState()
      expect(approval.isToolApproved('thread-1', 'b::c', 'a')).toBe(true)
      expect(approval.isToolApproved('thread-1', 'c', 'a::b')).toBe(false)
    })
  })

  describe('approveServer', () => {
    it('approves every tool from that server, in any thread', () => {
      const { result } = renderHook(() => useToolApproval())

      act(() => {
        result.current.approveServer('github')
      })

      expect(
        result.current.isToolApproved('thread-1', 'create_issue', 'github')
      ).toBe(true)
      expect(
        result.current.isToolApproved('thread-9', 'list_repos', 'github')
      ).toBe(true)
    })

    it('leaves other servers alone', () => {
      const { result } = renderHook(() => useToolApproval())

      act(() => {
        result.current.approveServer('github')
      })

      expect(
        result.current.isToolApproved('thread-1', 'read_file', 'filesystem')
      ).toBe(false)
    })

    it('does not duplicate a server approved twice', () => {
      const { result } = renderHook(() => useToolApproval())

      act(() => {
        result.current.approveServer('github')
        result.current.approveServer('github')
      })

      expect(result.current.approvedServers).toEqual(['github'])
    })
  })

  describe('approveToolEverywhere', () => {
    it('approves the tool in every thread', () => {
      const { result } = renderHook(() => useToolApproval())

      act(() => {
        result.current.approveToolEverywhere('tool-a')
      })

      expect(result.current.isToolApproved('thread-1', 'tool-a')).toBe(true)
      expect(result.current.isToolApproved('thread-2', 'tool-a')).toBe(true)
      expect(result.current.isToolApproved('thread-1', 'tool-b')).toBe(false)
    })
  })

  describe('state management', () => {
    it('should maintain state across multiple hook instances', () => {
      const { result: result1 } = renderHook(() => useToolApproval())
      const { result: result2 } = renderHook(() => useToolApproval())

      act(() => {
        result1.current.approveToolForThread('thread-1', 'tool-a')
        result1.current.setAllowAllMCPPermissions(true)
      })

      expect(result2.current.approvedTools['thread-1']).toContain('tool-a')
      expect(result2.current.allowAllMCPPermissions).toBe(true)
    })
  })
})
