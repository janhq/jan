import { invoke } from '@tauri-apps/api/core'

/**
 * The saved subagent definitions available to a Cowork run.
 *
 * Desktop keeps a single directory (`<janDataFolder>/agent-workspace/subagents`)
 * rather than the CLI's plugin/user/project merge: a default session has no
 * project root, and an attached folder is mounted read-only, so scanning it
 * would let a cloned repo inject a system prompt and a tool allowlist into the
 * agent. See `core/agent/subagent.rs::desktop_subagents_dir`.
 *
 * Field names stay snake_case because the same JSON shape is what the `task`
 * tool receives from the model.
 */
export type SubagentDefinition = {
  name: string
  description: string
  system_prompt: string
  /** Narrows the child's toolset. `null` inherits the parent's. */
  allowed_tools: string[] | null
  model: string | null
}

let cache: SubagentDefinition[] | null = null

/**
 * Saved definitions, cached for the app's lifetime.
 *
 * Never throws: an unreadable directory or a missing command costs the run its
 * saved names, not the run itself — a one-off subagent with an inline
 * `system_prompt` still works, which is how the `task` tool stays usable.
 */
export async function listSubagents(): Promise<SubagentDefinition[]> {
  if (cache) return cache
  try {
    cache = await invoke<SubagentDefinition[]>('agent_subagent_list')
  } catch {
    cache = []
  }
  return cache
}

/** Drop the cache so a newly written definition shows up without a restart. */
export function refreshSubagents(): void {
  cache = null
}

export const __testing = {
  reset: () => {
    cache = null
  },
}
