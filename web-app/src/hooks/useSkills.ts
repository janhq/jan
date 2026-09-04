import { invoke } from '@tauri-apps/api/core'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { create } from 'zustand'
import { toast } from 'sonner'
import * as skillStore from '@/lib/skillStore'
import { getServiceHub } from '@/hooks/useServiceHub'
import type { SkillMeta } from '@/lib/skillStore'

export type { SkillMeta }
export type HubSkill = { name: string; description: string }

// The `[skills].enabled` whitelist uses three shapes:
//   []          -> all skills enabled (scaffold default; backward compatible)
//   ['a','b']   -> only the named skills
//   [SKILLS_NONE] -> no skills enabled
// SKILLS_NONE is the empty string, which a real skill name can never be (skill
// names are non-empty file/folder stems). The backend already advertises nothing
// for a whitelist that matches no real skill, so this needs no backend special
// case — it just makes "none" representable, unlike a bare [] (which means all).
export const SKILLS_NONE = ''

/** Resolve the stored whitelist to the set of skills actually enabled. */
export function effectiveEnabled(
  enabled: string[],
  allNames: string[]
): Set<string> {
  if (enabled.length === 0) return new Set(allNames)
  // Drop the sentinel and any stale names (e.g. a since-deleted skill).
  return new Set(
    enabled.filter((n) => n !== SKILLS_NONE && allNames.includes(n))
  )
}

/** Encode a desired enabled-set back into the stored whitelist shape. */
export function storedEnabled(next: Set<string>, allNames: string[]): string[] {
  if (next.size >= allNames.length) return [] // all -> canonical empty
  if (next.size === 0) return [SKILLS_NONE] // none -> sentinel
  return [...next]
}

// Shared mutation counter so every useSkills instance (e.g. the manager dialog
// and the input's SkillSelector) re-fetches when any of them changes a skill.
const useSkillsVersion = create<{ v: number; bump: () => void }>((set) => ({
  v: 0,
  bump: () => set((s) => ({ v: s.v + 1 })),
}))

/**
 * CRUD over the agent's skills. With a `folder`, the project's co-located
 * store (`<folder>/.jan/agent/skills`); without one, the permanent store in
 * the Jan data folder -- which is also what the Cowork agent's `skill_*`
 * tools read, so the sidebar manager works with nothing attached. The
 * `[skills].enabled` whitelist stays a project concern: with no folder it has
 * nowhere to live, so everything reads as enabled and `setEnabled` is a no-op.
 */
export function useSkills(folder: string | null) {
  const [skills, setSkills] = useState<SkillMeta[]>([])
  // Enabled-skill whitelist from `[skills].enabled`; empty = all skills enabled.
  const [enabled, setEnabledState] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const version = useSkillsVersion((s) => s.v)
  const bump = useSkillsVersion((s) => s.bump)
  // Mirrors `enabled` so `setEnabled` can roll back to the last known value after
  // an await without depending on (and being recreated by) the state itself.
  const enabledRef = useRef<string[]>([])

  const scope = useMemo(
    () => (folder ? skillStore.projectScope(folder) : skillStore.storeScope),
    [folder]
  )

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [list, en] = await Promise.all([
        skillStore.listSkills(scope),
        // The whitelist lives in the project's agent.toml; the permanent
        // store has none, so everything it holds is enabled.
        folder
          ? invoke<string[]>('agent_skill_enabled_get', { project: folder })
          : Promise.resolve([]),
      ])
      setSkills(list)
      setEnabledState(en)
      enabledRef.current = en
    } finally {
      setLoading(false)
    }
  }, [folder, scope])

  // Persist the enabled whitelist (empty = all). Optimistic local update; on a
  // write failure, roll back so the UI never diverges from the on-disk config.
  // Errors are surfaced and swallowed here so fire-and-forget callers (e.g. the
  // SkillSelector toggle) don't produce unhandled rejections.
  const setEnabled = useCallback(
    async (names: string[]) => {
      if (!folder) return
      const prev = enabledRef.current
      setEnabledState(names)
      enabledRef.current = names
      try {
        await invoke('agent_skill_enabled_set', {
          project: folder,
          enabled: names,
        })
        bump()
      } catch (e) {
        setEnabledState(prev)
        enabledRef.current = prev
        toast.error(String(e))
      }
    },
    [folder, bump]
  )

  // Re-fetch on folder change AND whenever any instance mutates skills.
  useEffect(() => {
    refresh()
  }, [refresh, version])

  const read = useCallback(
    (name: string) => skillStore.readSkill(scope, name),
    [scope]
  )

  const write = useCallback(
    async (name: string, content: string) => {
      await skillStore.writeSkill(scope, name, content)
      bump()
    },
    [scope, bump]
  )

  const remove = useCallback(
    async (name: string) => {
      await skillStore.deleteSkill(scope, name)
      bump()
    },
    [scope, bump]
  )

  // Anthropic skill hub. `hubList` is project-independent; `hubImport` downloads
  // into the current folder (or, with none, the permanent store, which needs
  // the data folder to locate), then bumps so all instances re-fetch.
  const hubList = useCallback(
    () => invoke<HubSkill[]>('agent_skill_hub_list'),
    []
  )

  const hubImport = useCallback(
    async (name: string) => {
      const dataFolder = folder
        ? undefined
        : ((await getServiceHub().app().getJanDataFolder()) ?? undefined)
      await invoke('agent_skill_hub_import', {
        project: folder ?? undefined,
        dataFolder,
        name,
      })
      bump()
    },
    [folder, bump]
  )

  return {
    skills,
    enabled,
    setEnabled,
    loading,
    refresh,
    read,
    write,
    remove,
    hubList,
    hubImport,
  }
}
