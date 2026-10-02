import {
  workspacePath,
  memoryList,
  memoryRead,
  memoryWrite,
  memoryDelete,
} from '@janhq/tauri-plugin-agent-tools-api'
import { getServiceHub } from '@/hooks/useServiceHub'
import { invalidateMemory } from '@/lib/agentTools'
import * as skillStore from '@/lib/skillStore'
import type { SkillMeta } from '@/lib/skillStore'

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

// Skill CRUD is shared with the code screen's per-project skills; only the root
// differs. These bind this page to the permanent store.
export const listSkills = () => skillStore.listSkills(skillStore.storeScope)
export const readSkill = (name: string) =>
  skillStore.readSkill(skillStore.storeScope, name)
export const writeSkill = (name: string, content: string) =>
  skillStore.writeSkill(skillStore.storeScope, name, content)
export const deleteSkill = (name: string) =>
  skillStore.deleteSkill(skillStore.storeScope, name)

export async function listMemories(): Promise<string[]> {
  return await memoryList(await dataFolder())
}

export async function readMemory(name: string): Promise<string> {
  return await memoryRead(await dataFolder(), name)
}

export async function writeMemory(name: string, content: string): Promise<void> {
  await memoryWrite(await dataFolder(), name, content)
  invalidateMemory()
}

export async function deleteMemory(name: string): Promise<void> {
  await memoryDelete(await dataFolder(), name)
  invalidateMemory()
}

/**
 * A filesystem-safe note name from a thread title. The store's names are file
 * stems, so everything but `[a-z0-9-]` collapses to hyphens; an unusable title
 * falls back to a generic stem rather than failing the save.
 */
export function slugifyMemoryName(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '')
  return slug || 'memory'
}

export type RememberResult = {
  name: string
  /** True when a note with this exact content already existed; nothing was written. */
  duplicate: boolean
}

/**
 * The chat surface's "Remember" action: save `content` as a note named after
 * the thread title. `memory_write` replaces a note by name, and this is a new
 * fact rather than a curated topic, so an existing name gets a `-2`, `-3`, ...
 * suffix instead of silently overwriting it. A sibling that already holds this
 * exact content is returned instead of being copied again, so a second click
 * on the same message is a no-op. A sibling that cannot be read counts as
 * different: the save must not fail over one unreadable note.
 */
export async function rememberNote(
  title: string,
  content: string
): Promise<RememberResult> {
  const base = slugifyMemoryName(title)
  const taken = new Set(await listMemories())
  let name = base
  for (let n = 2; taken.has(name); n++) {
    const existing = await readMemory(name).catch(() => null)
    if (existing === content) return { name, duplicate: true }
    name = `${base}-${n}`
  }
  await writeMemory(name, content)
  return { name, duplicate: false }
}

/** Open the store in the OS file manager. */
export async function revealStore(): Promise<void> {
  await getServiceHub().opener().openPath(await storePath())
}
