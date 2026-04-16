import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('ulidx', () => ({
  ulid: vi.fn(() => 'mock-ulid-789'),
}))

import { DefaultProjectsService } from '../default'

const STORAGE_KEY = 'thread-management'

beforeEach(() => {
  localStorage.clear()
})

function seedStorage(folders: any[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ state: { folders }, version: 0 }))
}

describe('DefaultProjectsService - additional coverage', () => {
  it('updateProject leaves non-matching projects unchanged', async () => {
    seedStorage([
      { id: 'a', name: 'A', updated_at: 1 },
      { id: 'b', name: 'B', updated_at: 2 },
    ])
    const svc = new DefaultProjectsService()
    await svc.updateProject('a', 'A-Updated', 'assist-1')
    const projects = await svc.getProjects()
    expect(projects[0].name).toBe('A-Updated')
    expect(projects[1].name).toBe('B')
    expect(projects[1].updated_at).toBe(2)
  })
})
