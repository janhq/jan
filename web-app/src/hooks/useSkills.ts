import { invoke } from '@tauri-apps/api/core'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { create } from 'zustand'
import { toast } from 'sonner'
import * as skillStore from '@/lib/skillStore'
import { getServiceHub } from '@/hooks/useServiceHub'
import type { SkillMeta } from '@/lib/skillStore'

export type { SkillMeta }
export type HubSkill = { name: string; description: string }

/** Which store a listed skill came from. `project` shadows `store` on a name
 * collision, matching the agent's runtime precedence (#8879). */
export type SkillOrigin = 'store' | 'project'
export type ScopedSkill = SkillMeta & { origin: SkillOrigin }

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
 * CRUD over the agent's skills. The permanent store in the Jan data folder is
 * always listed -- it is what the Cowork agent's `skill_*` tools read by
 * default -- and with a `folder` its co-located store
 * (`<folder>/.jan/agent/skills`) layers on top, a project skill shadowing a
 * same-named global one (#8879). Each returned skill carries its `origin` so
 * `read`/`write`/`remove` target the store it lives in; a brand-new skill lands
 * in the folder's store when one is attached, else the permanent store. The
 * `[skills].enabled` whitelist stays a project concern: with no folder it has
 * nowhere to live, so everything reads as enabled and `setEnabled` is a no-op.
 */
export function useSkills(folder: string | null) {
  const [skills, setSkills] = useState<ScopedSkill[]>([])
  // Enabled-skill whitelist from `[skills].enabled`; empty = all skills enabled.
  const [enabled, setEnabledState] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const version = useSkillsVersion((s) => s.v)
  const bump = useSkillsVersion((s) => s.bump)
  // Mirrors `enabled` so `setEnabled` can roll back to the last known value after
  // an await without depending on (and being recreated by) the state itself.
  const enabledRef = useRef<string[]>([])
  // name -> origin, so the CRUD callbacks route each skill to its own store
  // without depending on (and being recreated by) the `skills` state.
  const originRef = useRef<Map<string, SkillOrigin>>(new Map())

  // Where a NEW skill is written: the folder's store when attached, else global.
  const newScope = useMemo(
    () => (folder ? skillStore.projectScope(folder) : skillStore.storeScope),
    [folder]
  )
  const scopeOf = useCallback(
    (name: string) => {
      const origin = originRef.current.get(name)
      if (origin === 'project' && folder) return skillStore.projectScope(folder)
      if (origin === 'store') return skillStore.storeScope
      return newScope
    },
    [folder, newScope]
  )

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [storeList, projectList, en] = await Promise.all([
        skillStore.listSkills(skillStore.storeScope),
        folder
          ? skillStore.listSkills(skillStore.projectScope(folder))
          : Promise.resolve([]),
        // The whitelist lives in the project's agent.toml; the permanent
        // store has none, so everything it holds is enabled.
        folder
          ? invoke<string[]>('agent_skill_enabled_get', { project: folder })
          : Promise.resolve([]),
      ])
      // Folder skills layer on top: a project skill shadows a same-named global
      // one, matching the agent's runtime precedence (#8879).
      const merged = new Map<string, ScopedSkill>()
      for (const s of storeList) merged.set(s.name, { ...s, origin: 'store' })
      for (const s of projectList) merged.set(s.name, { ...s, origin: 'project' })
      const list = [...merged.values()].sort((a, b) =>
        a.name.localeCompare(b.name)
      )
      setSkills(list)
      originRef.current = new Map(list.map((s) => [s.name, s.origin]))
      setEnabledState(en)
      enabledRef.current = en
    } catch (e) {
      // A discovery failure must be actionable, not a silently empty list (#8878).
      toast.error(String(e))
    } finally {
      setLoading(false)
    }
  }, [folder])

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
    (name: string) => skillStore.readSkill(scopeOf(name), name),
    [scopeOf]
  )

  const write = useCallback(
    async (name: string, content: string) => {
      await skillStore.writeSkill(scopeOf(name), name, content)
      bump()
    },
    [scopeOf, bump]
  )

  const remove = useCallback(
    async (name: string) => {
      await skillStore.deleteSkill(scopeOf(name), name)
      bump()
    },
    [scopeOf, bump]
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
