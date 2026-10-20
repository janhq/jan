import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('ulidx', () => ({
  ulid: vi.fn(() => 'mock-ulid-456'),
}))

import { DefaultProjectsService } from '../default'

const STORAGE_KEY = 'thread-management'

afterEach(() => vi.restoreAllMocks())

beforeEach(() => {
  localStorage.clear()
})

function seedStorage(folders: any[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ state: { folders }, version: 0 }))
}

describe('DefaultProjectsService', () => {
  it('getProjects returns empty array when nothing stored', async () => {
    const svc = new DefaultProjectsService()
    expect(await svc.getProjects()).toEqual([])
  })

  it('getProjects returns stored folders', async () => {
    seedStorage([{ id: '1', name: 'P1', updated_at: 100 }])
    const svc = new DefaultProjectsService()
    const projects = await svc.getProjects()
    expect(projects).toHaveLength(1)
    expect(projects[0].name).toBe('P1')
  })

  it('getProjects rejects invalid JSON', async () => {
    localStorage.setItem(STORAGE_KEY, 'not-json')
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const svc = new DefaultProjectsService()
    await expect(svc.getProjects()).rejects.toThrow()
    spy.mockRestore()
  })

  it('addProject creates and persists a new project', async () => {
    const svc = new DefaultProjectsService()
    const p = await svc.addProject('NewProj', 'assistant-1')
    expect(p.id).toBe('mock-ulid-456')
    expect(p.name).toBe('NewProj')
    expect(p.assistantId).toBe('assistant-1')
    const stored = await svc.getProjects()
    expect(stored).toHaveLength(1)
  })

  it('updateProject updates name and assistantId', async () => {
    seedStorage([{ id: 'x', name: 'Old', updated_at: 1 }])
    const svc = new DefaultProjectsService()
    await svc.updateProject('x', 'New', 'a2')
    const projects = await svc.getProjects()
    expect(projects[0].name).toBe('New')
    expect(projects[0].assistantId).toBe('a2')
  })

  it('deleteProject removes the project', async () => {
    seedStorage([{ id: 'a', name: 'A', updated_at: 1 }, { id: 'b', name: 'B', updated_at: 2 }])
    const svc = new DefaultProjectsService()
    await svc.deleteProject('a')
    const projects = await svc.getProjects()
    expect(projects).toHaveLength(1)
    expect(projects[0].id).toBe('b')
  })

  it('getProjectById returns the matching project', async () => {
    seedStorage([{ id: 'x', name: 'X', updated_at: 1 }])
    const svc = new DefaultProjectsService()
    const p = await svc.getProjectById('x')
    expect(p?.name).toBe('X')
  })

  it('getProjectById returns undefined when not found', async () => {
    const svc = new DefaultProjectsService()
    expect(await svc.getProjectById('nonexistent')).toBeUndefined()
  })

  it('setProjects replaces all projects', async () => {
    const svc = new DefaultProjectsService()
    await svc.setProjects([{ id: 'z', name: 'Z', updated_at: 9 }])
    expect(await svc.getProjects()).toHaveLength(1)
  })

  it('addProject rejects a failed storage write', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded')
    })
    const svc = new DefaultProjectsService()
    await expect(svc.addProject('Fail')).rejects.toThrow('quota exceeded')
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
    setItemSpy.mockRestore()
  })

  it('loadFromStorage returns [] when state.folders missing', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ state: {} }))
    const svc = new DefaultProjectsService()
    expect(await svc.getProjects()).toEqual([])
  })
})


describe('project persistence failures', () => {
  const existing = [{ id: 'existing', name: 'Keep me', updated_at: 1 }]
  const operations = [
    ['add', (svc: DefaultProjectsService) => svc.addProject('New')],
    ['update', (svc: DefaultProjectsService) => svc.updateProject('existing', 'Changed')],
    ['delete', (svc: DefaultProjectsService) => svc.deleteProject('existing')],
  ] as const

  it.each(operations)('%s preserves projects when the initial read fails', async (_, operation) => {
    seedStorage(existing)
    const original = localStorage.getItem(STORAGE_KEY)
    const read = vi.spyOn(Storage.prototype, 'getItem').mockImplementationOnce(() => {
      throw new Error('read unavailable')
    })
    try {
      await expect(operation(new DefaultProjectsService())).rejects.toThrow('read unavailable')
      expect(localStorage.getItem(STORAGE_KEY)).toBe(original)
    } finally {
      read.mockRestore()
    }
  })

  it('does not replace corrupt storage with a newly added project', async () => {
    localStorage.setItem(STORAGE_KEY, '{broken')
    await expect(new DefaultProjectsService().addProject('New')).rejects.toThrow()
    expect(localStorage.getItem(STORAGE_KEY)).toBe('{broken')
  })

  it.each(operations)('%s reports a write failure and can be retried', async (_, operation) => {
    seedStorage(existing)
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
      throw new Error('quota exceeded')
    })
    try {
      const svc = new DefaultProjectsService()
      await expect(operation(svc)).rejects.toThrow('quota exceeded')
      expect(await svc.getProjects()).toEqual(existing)
      await operation(svc)
      expect(await svc.getProjects()).not.toEqual(existing)
    } finally {
      write.mockRestore()
    }
  })
})
