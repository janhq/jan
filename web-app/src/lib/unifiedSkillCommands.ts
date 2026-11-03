import { invoke } from '@tauri-apps/api/core'
import { listSkills, invokeSkill, storeScope, projectScope } from './skillStore'
import { parseSkillCommand, resolveSkillCommand } from './skillCommands'

export const UNIFIED_RESERVED_COMMANDS = new Set(['help', 'clear', 'compact', 'models', 'plan', 'todo', 'tasks', 'init'])

export function unifiedSkillCommandAvailable(text: string): boolean {
  const parsed = parseSkillCommand(text)
  return !!parsed && (parsed.explicit || !UNIFIED_RESERVED_COMMANDS.has(parsed.name))
}

/** Shared discovery precedence with Cowork: project shadows store. */
export async function expandUnifiedSkillCommand(text: string, folder?: string): Promise<string> {
  const parsed = parseSkillCommand(text)
  if (!parsed) return text
  if (!unifiedSkillCommandAvailable(text)) throw new Error(`Command /${parsed.name} is unavailable in this composer.`)
  const global = await listSkills(storeScope)
  const project = folder ? await listSkills(projectScope(folder)) : []
  const merged = new Map(global.map((s) => [s.name, s]))
  for (const skill of project) merged.set(skill.name, skill)
  const enabled = folder ? await invoke<string[]>('agent_skill_enabled_get', { project: folder }) : []
  const available = [...merged.values()].filter((skill) => enabled.length === 0 || enabled.includes(skill.name))
  const skill = resolveSkillCommand(available, parsed)
  if (!skill) throw new Error(`Skill command /${parsed.name} is unavailable. Use an installed, user-invocable skill.`)
  return invokeSkill(project.some((s) => s.name === skill.name) && folder ? projectScope(folder) : storeScope, skill.name, parsed.args)
}
