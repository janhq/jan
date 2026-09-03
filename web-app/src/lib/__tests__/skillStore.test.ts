import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  listSkills,
  readSkill,
  writeSkill,
  deleteSkill,
  projectScope,
  storeScope,
} from '@/lib/skillStore'

// Hoisted: vi.mock factories are lifted above module-level consts, so the spies
// have to be created in the same hoisted scope to be referenceable there.
const { api, invoke, getJanDataFolder } = vi.hoisted(() => ({
  api: {
    skillList: vi.fn(),
    skillRead: vi.fn(),
    skillWrite: vi.fn(),
    skillDelete: vi.fn(),
  },
  invoke: vi.fn(),
  getJanDataFolder: vi.fn(),
}))

vi.mock('@janhq/tauri-plugin-agent-tools-api', () => api)
vi.mock('@tauri-apps/api/core', () => ({ invoke }))
vi.mock('@/hooks/useServiceHub', () => ({
  getServiceHub: () => ({ app: () => ({ getJanDataFolder }) }),
}))

describe('skillStore', () => {
  beforeEach(() => {
    Object.values(api).forEach((fn) => fn.mockReset())
    invoke.mockReset().mockResolvedValue(undefined)
    getJanDataFolder.mockReset().mockResolvedValue('/data')
  })

  describe('store scope', () => {
    it('goes through guest-js against the data folder, with no project', async () => {
      api.skillList.mockResolvedValue([{ name: 'deploy', description: 'd' }])
      api.skillRead.mockResolvedValue('body')

      await expect(listSkills(storeScope)).resolves.toEqual([
        { name: 'deploy', description: 'd' },
      ])
      await expect(readSkill(storeScope, 'deploy')).resolves.toBe('body')
      await writeSkill(storeScope, 'deploy', 'text')
      await deleteSkill(storeScope, 'deploy')

      expect(api.skillList).toHaveBeenCalledWith('/data')
      expect(api.skillRead).toHaveBeenCalledWith('/data', 'deploy')
      expect(api.skillWrite).toHaveBeenCalledWith('/data', 'deploy', 'text')
      expect(api.skillDelete).toHaveBeenCalledWith('/data', 'deploy')
      expect(invoke).not.toHaveBeenCalled()
    })

    it('fails loudly when the data folder is unavailable', async () => {
      getJanDataFolder.mockResolvedValue(null)
      await expect(listSkills(storeScope)).rejects.toThrow(
        'Jan data folder is unavailable'
      )
    })
  })

  describe('project scope', () => {
    const scope = projectScope('/proj')

    it('routes every operation to the core commands with the project path', async () => {
      invoke.mockResolvedValueOnce([{ name: 'lint', description: 'l' }])
      await expect(listSkills(scope)).resolves.toEqual([
        { name: 'lint', description: 'l' },
      ])
      expect(invoke).toHaveBeenCalledWith('agent_skill_list', {
        project: '/proj',
      })

      invoke.mockResolvedValueOnce('body')
      await expect(readSkill(scope, 'lint')).resolves.toBe('body')
      expect(invoke).toHaveBeenCalledWith('agent_skill_read', {
        project: '/proj',
        name: 'lint',
      })

      await deleteSkill(scope, 'lint')
      expect(invoke).toHaveBeenCalledWith('agent_skill_delete', {
        project: '/proj',
        name: 'lint',
      })
    })

    // agent_skill_write also runs ensure_project, scaffolding agent.toml. The
    // plugin owns no config format and cannot write it, so routing this through
    // guest-js would silently drop the scaffold.
    it('writes through the core command so the project scaffold is preserved', async () => {
      await writeSkill(scope, 'lint', 'text')
      expect(invoke).toHaveBeenCalledWith('agent_skill_write', {
        project: '/proj',
        name: 'lint',
        content: 'text',
      })
      expect(api.skillWrite).not.toHaveBeenCalled()
    })

    it('never resolves the data folder, so it cannot reach the permanent store', async () => {
      invoke.mockResolvedValueOnce([])
      await listSkills(scope)
      await writeSkill(scope, 'lint', 'text')
      expect(getJanDataFolder).not.toHaveBeenCalled()
    })
  })
})
