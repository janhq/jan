import { invoke } from '@tauri-apps/api/core'
import {
  skillList,
  skillRead,
  skillWrite,
  skillDelete,
  type SkillMeta,
} from '@janhq/tauri-plugin-agent-tools-api'
import { getServiceHub } from '@/hooks/useServiceHub'

export type { SkillMeta }

/**
 * Skill CRUD, for both roots a skill can live under.
 *
 * A skill is the same thing on disk either way -- `<root>/skills/<name>/SKILL.md`
 * -- and Rust runs one implementation for both. Only the root differs, so this is
 * the single place that picks one:
 *
 * - `store`   -- the desktop's permanent store in the Jan data folder, managed
 *                from Settings. Reached through the plugin's guest-js.
 * - `project` -- a project's co-located `<folder>/.jan/agent`, managed from the
 *                code screen.
 *
 * The project scope deliberately keeps using the core `agent_skill_*` commands
 * rather than the plugin's. They are not redundant: `agent_skill_write` also runs
 * `ensure_project`, which scaffolds `agent.toml`. That format is
 * owned by `core::agent::project`, and the plugin must not learn to write it --
 * owning no config format is what let the toolset be extracted at all. Routing
 * project writes through guest-js would silently drop the scaffold.
 */
export type SkillScope =
  | { kind: 'store' }
  | { kind: 'project'; folder: string }

export const storeScope: SkillScope = { kind: 'store' }
export const projectScope = (folder: string): SkillScope => ({
  kind: 'project',
  folder,
})

const dataFolder = async (): Promise<string> => {
  const folder = await getServiceHub().app().getJanDataFolder()
  if (!folder) throw new Error('Jan data folder is unavailable')
  return folder
}

export async function listSkills(scope: SkillScope): Promise<SkillMeta[]> {
  if (scope.kind === 'project') {
    return await invoke<SkillMeta[]>('agent_skill_list', {
      project: scope.folder,
    })
  }
  return await skillList(await dataFolder())
}

/** Raw SKILL.md text, frontmatter included. */
export async function readSkill(
  scope: SkillScope,
  name: string
): Promise<string> {
  if (scope.kind === 'project') {
    return await invoke<string>('agent_skill_read', {
      project: scope.folder,
      name,
    })
  }
  return await skillRead(await dataFolder(), name)
}

export async function writeSkill(
  scope: SkillScope,
  name: string,
  content: string
): Promise<void> {
  if (scope.kind === 'project') {
    await invoke('agent_skill_write', {
      project: scope.folder,
      name,
      content,
    })
    return
  }
  await skillWrite(await dataFolder(), name, content)
}

export async function deleteSkill(
  scope: SkillScope,
  name: string
): Promise<void> {
  if (scope.kind === 'project') {
    await invoke('agent_skill_delete', { project: scope.folder, name })
    return
  }
  await skillDelete(await dataFolder(), name)
}
