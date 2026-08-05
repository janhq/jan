import {
  workspacePath,
  skillList,
  skillRead,
  skillWrite,
  skillDelete,
  memoryList,
  memoryRead,
  memoryWrite,
  memoryDelete,
  type SkillMeta,
} from '@janhq/tauri-plugin-agent-tools-api'
import { getServiceHub } from '@/hooks/useServiceHub'

export type { SkillMeta }

/**
 * The management surface over the agent's permanent store, for the settings UI.
 * Separate from `agentTools.ts`, which is the chat-loop surface: this one edits
 * what the agent remembers, that one executes what the model calls.
 *
 * Errors are thrown rather than swallowed. Unlike a tool call, a failed edit has
 * a user waiting on it, so the page surfaces it.
 */

const dataFolder = async (): Promise<string> => {
  const folder = await getServiceHub().app().getJanDataFolder()
  if (!folder) throw new Error('Jan data folder is unavailable')
  return folder
}

/** Path of the permanent store, created if absent. */
export async function storePath(): Promise<string> {
  return await workspacePath(await dataFolder())
}

export async function listSkills(): Promise<SkillMeta[]> {
  return await skillList(await dataFolder())
}

/** Raw SKILL.md text, frontmatter included. */
export async function readSkill(name: string): Promise<string> {
  return await skillRead(await dataFolder(), name)
}

export async function writeSkill(name: string, content: string): Promise<void> {
  await skillWrite(await dataFolder(), name, content)
}

export async function deleteSkill(name: string): Promise<void> {
  await skillDelete(await dataFolder(), name)
}

export async function listMemories(): Promise<string[]> {
  return await memoryList(await dataFolder())
}

export async function readMemory(name: string): Promise<string> {
  return await memoryRead(await dataFolder(), name)
}

export async function writeMemory(name: string, content: string): Promise<void> {
  await memoryWrite(await dataFolder(), name, content)
}

export async function deleteMemory(name: string): Promise<void> {
  await memoryDelete(await dataFolder(), name)
}

/** Open the store in the OS file manager. */
export async function revealStore(): Promise<void> {
  await getServiceHub().opener().revealItemInDir(await storePath())
}
