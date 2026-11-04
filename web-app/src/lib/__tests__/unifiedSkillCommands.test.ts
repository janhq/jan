vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => []) }))
import { beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('../skillStore', () => ({
  storeScope: { kind: 'store' }, projectScope: (folder: string) => ({ kind: 'project', folder }),
  listSkills: vi.fn(), invokeSkill: vi.fn(async () => 'expanded skill'),
}))
import { invoke } from '@tauri-apps/api/core'
import { listSkills, invokeSkill } from '../skillStore'
import { expandUnifiedSkillCommand } from '../unifiedSkillCommands'

describe('unified skill invocation', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.mocked(invoke).mockResolvedValue([]) })
  it('preserves ordinary text', async () => {
    expect(await expandUnifiedSkillCommand('hello')).toBe('hello')
    expect(listSkills).not.toHaveBeenCalled()
  })
  it.each(['/usr/bin/python', '/tmp/example', '/word', '/word args'])('preserves ordinary slash text: %s', async (text) => {
    vi.mocked(listSkills).mockResolvedValue([])
    expect(await expandUnifiedSkillCommand(text)).toBe(text)
    expect(invokeSkill).not.toHaveBeenCalled()
  })
  it('refuses explicitly requested missing skills instead of sending the command', async () => {
    vi.mocked(listSkills).mockResolvedValue([])
    await expect(expandUnifiedSkillCommand('/skill:missing args')).rejects.toThrow('Skill command /missing is unavailable')
    expect(invokeSkill).not.toHaveBeenCalled()
  })
  it.each(['/clear', '/help me debug', '/plan the migration'])('preserves reserved slash prose despite skill collisions: %s', async (text) => {
    vi.mocked(listSkills).mockResolvedValue(['clear', 'help', 'plan'].map((name) => ({ name, description: '' })))
    expect(await expandUnifiedSkillCommand(text)).toBe(text)
    expect(listSkills).not.toHaveBeenCalled()
    expect(invokeSkill).not.toHaveBeenCalled()
    expect(await expandUnifiedSkillCommand('/skill:clear')).toBe('expanded skill')
  })
  it('preserves bare commands that do not resolve to an enabled user-invocable skill', async () => {
    vi.mocked(listSkills).mockResolvedValue([{ name: 'hidden', description: '', user_invocable: false }])
    expect(await expandUnifiedSkillCommand('/hidden')).toBe('/hidden')
    expect(invokeSkill).not.toHaveBeenCalled()
  })
  it('uses project precedence, namespaced names and arguments', async () => {
    vi.mocked(listSkills).mockResolvedValueOnce([{ name: 'team:review', description: '' }]).mockResolvedValueOnce([{ name: 'team:review', description: '' }])
    expect(await expandUnifiedSkillCommand('/review this change', '/project')).toBe('expanded skill')
    expect(invokeSkill).toHaveBeenCalledWith({ kind: 'project', folder: '/project' }, 'team:review', 'this change')
  })
  it('honors the project enabled whitelist on dispatch, not just menu discovery', async () => {
    vi.mocked(listSkills).mockResolvedValue([{ name: 'review', description: '' }])
    vi.mocked(invoke).mockResolvedValue([''])
    await expect(expandUnifiedSkillCommand('/skill:review', '/project')).rejects.toThrow('unavailable')
    expect(invokeSkill).not.toHaveBeenCalled()
  })
  it('refuses unavailable and non-user-invocable commands', async () => {
    vi.mocked(listSkills).mockResolvedValue([{ name: 'hidden', description: '', user_invocable: false }])
    await expect(expandUnifiedSkillCommand('/skill:hidden')).rejects.toThrow('unavailable')
    expect(invokeSkill).not.toHaveBeenCalled()
  })
})
