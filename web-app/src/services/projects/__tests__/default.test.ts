import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('ulidx', () => ({
  ulid: vi.fn(() => 'mock-ulid-456'),
}))

import { DefaultProjectsService } from '../default'

const STORAGE_KEY = 'thread-management'

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

  it('getProjects returns [] on invalid JSON', async () => {
    localStorage.setItem(STORAGE_KEY, 'not-json')
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const svc = new DefaultProjectsService()
    expect(await svc.getProjects()).toEqual([])
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

  it('saveToStorage handles localStorage error gracefully', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded')
    })
    const svc = new DefaultProjectsService()
    // Should not throw
    await svc.addProject('Fail')
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
