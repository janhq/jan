import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { localStorageKey } from '@/constants/localStorage'

export type CodexProviderProfile = {
  id: string
  name: string
  baseUrl: string
  model: string
  apiKeyEnv?: string
  codexHome: string
  transport?: 'app-server' | 'proto'
  providerType: 'openai-compatible' | 'ollama' | 'llama-cpp' | 'custom'
  approvalPolicy?: 'untrusted' | 'on-failure' | 'on-request' | 'never'
  sandbox?: 'read-only' | 'workspace-write' | 'danger-full-access'
  /** Custom AGENTS.md content to write into this profile's CODEX_HOME for Codex to discover as global instructions. */
  agentsMd?: string
  // Subagents / custom agents support (emitted to [agents] in config for Codex engine)
  subagentMaxThreads?: number
  subagentMaxDepth?: number
  // Permission profile (newer Codex style; prefer over legacy sandbox when set)
  permissionProfile?: string
  // Custom agents for Codex subagent system. Each will be written as <name>.toml in codexHome/agents/
  customAgents?: Array<{
    name: string
    description: string
    developer_instructions: string
    model?: string
    sandbox_mode?: string
  }>
  /** Extra directories to grant write access for this profile's Codex sessions (maps to --add-dir / extraDirectories / worktree roots). One or more paths relative or absolute to the workspace. */
  addDirs?: string[]
  /** Raw advanced config TOML snippet (e.g. [hooks], [rules], [[skills]], [plugins] sections or other Codex config keys from docs). Appended to the generated config.toml for sessions using this profile so Codex discovers hooks/rules/skills/plugins etc. */
  advancedConfigSnippet?: string
  createdAt: number
  updatedAt: number
}

type CodexProviderProfileDraft = Omit<
  CodexProviderProfile,
  'id' | 'createdAt' | 'updatedAt'
> & { agentsMd?: string }

type CodexProviderProfileState = {
  profiles: Record<string, CodexProviderProfile>
  activeProfileId: string | null
  upsertProfile: (
    profile: CodexProviderProfileDraft & { id?: string }
  ) => CodexProviderProfile
  removeProfile: (profileId: string) => void
  setActiveProfile: (profileId: string | null) => void
}

const createProfileId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`

export const useCodexProviderProfiles = create<CodexProviderProfileState>()(
  persist(
    (set, get) => ({
      profiles: {},
      activeProfileId: null,

      upsertProfile: (profile) => {
        const now = Date.now()
        const existing = profile.id ? get().profiles[profile.id] : undefined
        const next: CodexProviderProfile = {
          id: profile.id ?? createProfileId(),
          name: profile.name,
          baseUrl: profile.baseUrl,
          model: profile.model,
          apiKeyEnv: profile.apiKeyEnv,
          codexHome: profile.codexHome,
          transport: profile.transport ?? 'app-server',
          providerType: profile.providerType,
          approvalPolicy: profile.approvalPolicy,
          sandbox: profile.sandbox,
          agentsMd: profile.agentsMd,
          subagentMaxThreads: profile.subagentMaxThreads,
          subagentMaxDepth: profile.subagentMaxDepth,
          permissionProfile: profile.permissionProfile,
          customAgents: profile.customAgents,
          addDirs: profile.addDirs,
          advancedConfigSnippet: profile.advancedConfigSnippet,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
        }

        set((state) => ({
          profiles: {
            ...state.profiles,
            [next.id]: next,
          },
          activeProfileId: state.activeProfileId ?? next.id,
        }))

        return next
      },

      removeProfile: (profileId) => {
        set((state) => {
          const profiles = { ...state.profiles }
          delete profiles[profileId]
          const activeProfileId =
            state.activeProfileId === profileId
              ? (Object.keys(profiles)[0] ?? null)
              : state.activeProfileId
          return { profiles, activeProfileId }
        })
      },

      setActiveProfile: (activeProfileId) => set({ activeProfileId }),
    }),
    {
      name: localStorageKey.codexProviderProfiles,
      storage: createJSONStorage(() => localStorage),
    }
  )
)
