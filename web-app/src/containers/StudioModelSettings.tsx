import { useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { X } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { useServiceHub } from '@/hooks/useServiceHub'
import { cn } from '@/lib/utils'
import { useCodexProviderProfiles } from '@/stores/codex-provider-profile-store'
import { useRuntimePermission } from '@/stores/runtime-permission-store'
import { useThreads } from '@/hooks/useThreads'
import {
  runCodexDoctor,
  runCodexExec,
  runCodexResume,
  readCodexRemoteControlStatus,
  enableCodexRemoteControl,
  disableCodexRemoteControl,
  startCodexRemoteControlPairing,
  listCodexPermissionProfiles,
} from '@/lib/codex-app-server'
import {
  useStudioSettings,
  type StudioSamplerSettings,
} from '@/stores/studio-settings-store'

function SamplerSlider({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (value: number) => void
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="text-foreground">{label}</span>
        <span className="font-mono text-xs text-muted-foreground">{value}</span>
      </div>
      <Slider
        min={min}
        max={max}
        step={step}
        value={[value]}
        onValueChange={([next]) => {
          if (next !== undefined) onChange(Number(next.toFixed(3)))
        }}
      />
    </div>
  )
}
function ModelSettingsSection({
  settings,
  setSettings,
}: {
  settings: StudioSamplerSettings
  setSettings: (settings: StudioSamplerSettings) => void
}) {
  const serviceHub = useServiceHub()
  const requestRuntimePermission = useRuntimePermission(
    (state) => state.requestPermission
  )
  const profiles = useCodexProviderProfiles((state) => state.profiles)
  const activeProfileId = useCodexProviderProfiles(
    (state) => state.activeProfileId
  )
  const upsertProfile = useCodexProviderProfiles((state) => state.upsertProfile)
  const removeProfile = useCodexProviderProfiles((state) => state.removeProfile)
  const setActiveProfile = useCodexProviderProfiles(
    (state) => state.setActiveProfile
  )
  const profileList = Object.values(profiles).sort(
    (a, b) => b.updatedAt - a.updatedAt
  )
  const activeProfile = activeProfileId ? profiles[activeProfileId] : undefined
  const [profileName, setProfileName] = useState('Local OpenAI-compatible')
  const [profileBaseUrl, setProfileBaseUrl] = useState(
    'http://localhost:11434/v1'
  )
  const [profileModel, setProfileModel] = useState('')
  const [profileApiKeyEnv, setProfileApiKeyEnv] = useState('OPENAI_API_KEY')
  const [profileCodexHome, setProfileCodexHome] = useState(
    '.codex/profiles/local'
  )
  const [profileTransport, setProfileTransport] = useState<
    'app-server' | 'proto'
  >('app-server')
  const [profileApprovalPolicy, setProfileApprovalPolicy] = useState<
    'untrusted' | 'on-failure' | 'on-request' | 'never'
  >('on-request')
  const [profileSandbox, setProfileSandbox] = useState<
    'read-only' | 'workspace-write' | 'danger-full-access'
  >('workspace-write')
  const [profileAgentsMd, setProfileAgentsMd] = useState('')
  const [profilePermissionProfile, setProfilePermissionProfile] = useState('')
  const [profileSubagentMaxThreads, setProfileSubagentMaxThreads] = useState<
    number | undefined
  >(undefined)
  const [profileSubagentMaxDepth, setProfileSubagentMaxDepth] = useState<
    number | undefined
  >(undefined)
  const [profileCustomAgentsJson, setProfileCustomAgentsJson] = useState('[]')
  const [profileAddDirs, setProfileAddDirs] = useState('')
  const [profileAdvancedConfigSnippet, setProfileAdvancedConfigSnippet] = useState('')
  const [editingProfileId, setEditingProfileId] = useState<string | undefined>(
    undefined
  )
  const [profileProbe, setProfileProbe] = useState<{
    loading: boolean
    reachable?: boolean
    statusCode?: number
    modelCount?: number
    error?: string
  }>({ loading: false })
  const [profileArtifactResult, setProfileArtifactResult] = useState<{
    codexHome: string
    manifestPath: string
    envPath: string
  } | null>(null)
  const [doctorLoading, setDoctorLoading] = useState(false)
  const [doctorResult, setDoctorResult] = useState<string | null>(null)
  const [execPrompt, setExecPrompt] = useState('Summarize uncommitted changes')
  const [execLoading, setExecLoading] = useState(false)
  const [execResult, setExecResult] = useState<string | null>(null)
  const [resumeSessionId, setResumeSessionId] = useState('')
  const [resumePrompt, setResumePrompt] = useState('')
  const [resumeLoading, setResumeLoading] = useState(false)
  const [resumeResult, setResumeResult] = useState<string | null>(null)
  const [remoteStatus, setRemoteStatus] = useState<unknown>(null)
  const [remoteLoading, setRemoteLoading] = useState(false)
  const [permissionProfiles, setPermissionProfiles] = useState<unknown>(null)
  const [permissionProfilesLoading, setPermissionProfilesLoading] =
    useState(false)
  const currentThreadId = useThreads((s) => s.currentThreadId)

  const applyProfilePreset = (
    preset: 'ollama' | 'llama-cpp' | 'openai-compatible'
  ) => {
    setEditingProfileId(undefined)
    setProfileProbe({ loading: false })
    setProfileArtifactResult(null)
    if (preset === 'ollama') {
      setProfileName('Ollama local')
      setProfileBaseUrl('http://localhost:11434/v1')
      setProfileModel('qwen3-coder')
      setProfileApiKeyEnv('OLLAMA_API_KEY')
      setProfileCodexHome('.codex/profiles/ollama')
      setProfileTransport('app-server')
      setProfileApprovalPolicy('on-request')
      setProfileSandbox('workspace-write')
      return
    }
    if (preset === 'llama-cpp') {
      setProfileName('llama.cpp local')
      setProfileBaseUrl('http://localhost:8080/v1')
      setProfileModel('local-model')
      setProfileApiKeyEnv('LLAMA_CPP_API_KEY')
      setProfileCodexHome('.codex/profiles/llama-cpp')
      setProfileTransport('app-server')
      setProfileApprovalPolicy('on-request')
      setProfileSandbox('workspace-write')
      return
    }
    setProfileName('OpenAI-compatible')
    setProfileBaseUrl('https://api.openai.com/v1')
    setProfileModel('gpt-4.1')
    setProfileApiKeyEnv('OPENAI_API_KEY')
    setProfileCodexHome('.codex/profiles/openai-compatible')
    setProfileTransport('app-server')
    setProfileApprovalPolicy('on-request')
    setProfileSandbox('workspace-write')
  }

  const startNewProfile = () => {
    setEditingProfileId(undefined)
    setProfileProbe({ loading: false })
    setProfileArtifactResult(null)
    setProfileName('Local OpenAI-compatible')
    setProfileBaseUrl('http://localhost:11434/v1')
    setProfileModel('')
    setProfileApiKeyEnv('OPENAI_API_KEY')
    setProfileCodexHome('.codex/profiles/local')
    setProfileTransport('app-server')
    setProfileApprovalPolicy('on-request')
    setProfileSandbox('workspace-write')
    setProfileAgentsMd('')
    setProfilePermissionProfile('')
    setProfileSubagentMaxThreads(undefined)
    setProfileSubagentMaxDepth(undefined)
    setProfileCustomAgentsJson('[]')
    setProfileAddDirs('')
    setProfileAdvancedConfigSnippet('')
  }

  const saveProfile = () => {
    const trimmedName = profileName.trim()
    const trimmedBaseUrl = profileBaseUrl.trim()
    const trimmedModel = profileModel.trim()
    const trimmedCodexHome = profileCodexHome.trim()
    if (!trimmedName || !trimmedBaseUrl || !trimmedModel || !trimmedCodexHome) {
      toast.info('Profile name, base URL, model, and CODEX_HOME are required')
      return
    }

    const saved = upsertProfile({
      id: editingProfileId,
      name: trimmedName,
      baseUrl: trimmedBaseUrl,
      model: trimmedModel,
      apiKeyEnv: profileApiKeyEnv.trim() || undefined,
      codexHome: trimmedCodexHome,
      transport: profileTransport,
      approvalPolicy: profileApprovalPolicy,
      sandbox: profileSandbox,
      agentsMd: profileAgentsMd.trim() || undefined,
      permissionProfile: profilePermissionProfile.trim() || undefined,
      subagentMaxThreads: profileSubagentMaxThreads,
      subagentMaxDepth: profileSubagentMaxDepth,
      customAgents: (() => {
        try {
          return JSON.parse(profileCustomAgentsJson || '[]')
        } catch {
          return []
        }
      })(),
      addDirs: profileAddDirs
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean),
      advancedConfigSnippet: profileAdvancedConfigSnippet.trim() || undefined,
      providerType: trimmedBaseUrl.includes('11434')
        ? 'ollama'
        : trimmedBaseUrl.includes('localhost')
          ? 'llama-cpp'
          : 'openai-compatible',
    })
    setActiveProfile(saved.id)
    setEditingProfileId(saved.id)
    toast.success('Runtime profile saved')
  }

  const loadProfileIntoForm = (profileId: string) => {
    const profile = profiles[profileId]
    if (!profile) return
    setProfileName(profile.name)
    setProfileBaseUrl(profile.baseUrl)
    setProfileModel(profile.model)
    setProfileApiKeyEnv(profile.apiKeyEnv ?? '')
    setProfileCodexHome(profile.codexHome)
    setProfileTransport(profile.transport ?? 'app-server')
    setProfileApprovalPolicy(profile.approvalPolicy ?? 'on-request')
    setProfileSandbox(profile.sandbox ?? 'workspace-write')
    setProfileAgentsMd(profile.agentsMd ?? '')
    setProfilePermissionProfile(profile.permissionProfile ?? '')
    setProfileSubagentMaxThreads(profile.subagentMaxThreads)
    setProfileSubagentMaxDepth(profile.subagentMaxDepth)
    setProfileCustomAgentsJson(
      JSON.stringify(profile.customAgents || [], null, 2)
    )
    setProfileAddDirs((profile as any).addDirs?.join('\n') || '')
    setProfileAdvancedConfigSnippet((profile as any).advancedConfigSnippet || '')
    setActiveProfile(profileId)
    setEditingProfileId(profileId)
    setProfileProbe({ loading: false })
    setProfileArtifactResult(null)
  }

  const probeProfileEndpoint = async () => {
    const baseUrl = profileBaseUrl.trim()
    if (!baseUrl) {
      toast.info('Base URL is required before probing')
      return
    }

    const allowed = await requestRuntimePermission({
      actionId: 'provider.probe-endpoint',
      actionLabel: 'probe provider endpoint',
      category: 'app',
      resourceLabel: baseUrl,
      risk:
        baseUrl.includes('localhost') || baseUrl.includes('127.0.0.1')
          ? 'low'
          : 'medium',
      details: {
        baseUrl,
        path: '/models',
      },
    })
    if (!allowed) return

    setProfileProbe({ loading: true })
    try {
      const result = await serviceHub.studio().probeOpenaiEndpoint(baseUrl)
      setProfileProbe({
        loading: false,
        reachable: result.reachable,
        statusCode: result.statusCode,
        modelCount: result.modelCount,
        error: result.error,
      })
      if (result.reachable) {
        toast.success('Provider endpoint reachable')
      } else {
        toast.error('Provider endpoint not reachable', {
          description: result.error,
        })
      }
    } catch (error) {
      setProfileProbe({
        loading: false,
        reachable: false,
        error: error instanceof Error ? error.message : String(error),
      })
      toast.error('Provider probe failed', {
        description: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const chooseCodexHomeDirectory = async () => {
    const allowed = await requestRuntimePermission({
      actionId: 'file.choose-codex-home',
      actionLabel: 'choose isolated CODEX_HOME directory',
      category: 'file',
      resourceLabel: profileCodexHome,
      risk: 'medium',
    })
    if (!allowed) return

    const selection = await serviceHub.dialog().open({
      directory: true,
      defaultPath: profileCodexHome,
    })
    if (!selection || Array.isArray(selection)) return
    setProfileCodexHome(selection)
    setProfileArtifactResult(null)
  }

  const writeProfileArtifacts = async () => {
    if (!activeProfile) {
      toast.info('Save or select a profile before writing artifacts')
      return
    }

    const allowed = await requestRuntimePermission({
      actionId: 'file.write-codex-provider-profile',
      actionLabel: 'write isolated provider profile artifacts',
      category: 'file',
      resourceLabel: activeProfile.codexHome,
      risk: 'medium',
      details: {
        codexHome: activeProfile.codexHome,
        baseUrl: activeProfile.baseUrl,
        model: activeProfile.model,
      },
    })
    if (!allowed) return

    const result = await invoke<{
      codexHome: string
      manifestPath: string
      envPath: string
    }>('write_codex_provider_profile_artifacts', {
      request: {
        name: activeProfile.name,
        baseUrl: activeProfile.baseUrl,
        model: activeProfile.model,
        apiKeyEnv: activeProfile.apiKeyEnv,
        codexHome: activeProfile.codexHome,
        providerType: activeProfile.providerType,
      },
    })

    setProfileArtifactResult(result)
    toast.success('Provider profile artifacts written')
  }

  const profilePreview = activeProfile
    ? {
        env: {
          CODEX_HOME: activeProfile.codexHome,
          OPENAI_BASE_URL: activeProfile.baseUrl,
          OPENAI_API_KEY: activeProfile.apiKeyEnv
            ? `$${activeProfile.apiKeyEnv}`
            : '<unset>',
        },
        profile: {
          provider_type: activeProfile.providerType,
          transport: activeProfile.transport ?? 'app-server',
          model: activeProfile.model,
          base_url: activeProfile.baseUrl,
          approvalPolicy: activeProfile.approvalPolicy ?? 'on-request',
          sandbox: activeProfile.sandbox ?? 'workspace-write',
        },
      }
    : null

  const copyProfilePreview = async () => {
    if (!profilePreview) return
    await navigator.clipboard.writeText(JSON.stringify(profilePreview, null, 2))
    toast.success('Runtime profile preview copied')
  }

  return (
    <div className="space-y-5">
      <section className="space-y-4 rounded-lg border border-border/60 bg-card p-4">
        <div>
          <h3 className="text-sm font-medium text-foreground">
            Runtime provider profiles
          </h3>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            UI-side config for OpenAI-compatible local or remote providers.
            These profiles are ready for Codex config generation without
            touching the app-server bridge.
          </p>
        </div>

        <div className="grid gap-3">
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" size="xs" onClick={startNewProfile}>
              New
            </Button>
            <Button
              variant="outline"
              size="xs"
              onClick={() => applyProfilePreset('ollama')}
            >
              Ollama
            </Button>
            <Button
              variant="outline"
              size="xs"
              onClick={() => applyProfilePreset('llama-cpp')}
            >
              llama.cpp
            </Button>
            <Button
              variant="outline"
              size="xs"
              onClick={() => applyProfilePreset('openai-compatible')}
            >
              OpenAI-compatible
            </Button>
          </div>

          <label className="block space-y-1.5 text-xs">
            <span className="text-muted-foreground">Profile name</span>
            <Input
              value={profileName}
              onChange={(event) => setProfileName(event.target.value)}
              placeholder="Local llama.cpp"
            />
          </label>
          <label className="block space-y-1.5 text-xs">
            <span className="text-muted-foreground">Base URL</span>
            <Input
              value={profileBaseUrl}
              onChange={(event) => setProfileBaseUrl(event.target.value)}
              placeholder="http://localhost:8080/v1"
            />
          </label>
          <label className="block space-y-1.5 text-xs">
            <span className="text-muted-foreground">Model</span>
            <Input
              value={profileModel}
              onChange={(event) => setProfileModel(event.target.value)}
              placeholder="qwen3-coder"
            />
          </label>
          <label className="block space-y-1.5 text-xs">
            <span className="text-muted-foreground">API key env</span>
            <Input
              value={profileApiKeyEnv}
              onChange={(event) => setProfileApiKeyEnv(event.target.value)}
              placeholder="OPENAI_API_KEY"
            />
          </label>
          <label className="block space-y-1.5 text-xs">
            <span className="text-muted-foreground">Isolated CODEX_HOME</span>
            <div className="flex gap-2">
              <Input
                value={profileCodexHome}
                onChange={(event) => setProfileCodexHome(event.target.value)}
                placeholder=".codex/profiles/local"
              />
              <Button
                variant="outline"
                size="xs"
                className="shrink-0"
                onClick={() => void chooseCodexHomeDirectory()}
              >
                Choose
              </Button>
            </div>
          </label>
          <label className="block space-y-1.5 text-xs">
            <span className="text-muted-foreground">Codex transport</span>
            <select
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none text-foreground dark:bg-neutral-900"
              value={profileTransport}
              onChange={(event) =>
                setProfileTransport(event.target.value as 'app-server' | 'proto')
              }
            >
              <option
                value="app-server"
                className="dark:bg-neutral-950 text-foreground"
              >
                app-server (JSON-RPC)
              </option>
              <option
                value="proto"
                className="dark:bg-neutral-950 text-foreground"
              >
                proto (CLI protocol fallback)
              </option>
            </select>
            <div className="text-[10px] leading-4 text-muted-foreground">
              Use proto only when your Codex CLI has `codex proto` but does not
              support `app-server --stdio`.
            </div>
          </label>
          <label className="block space-y-1.5 text-xs">
            <span className="text-muted-foreground">Approval policy</span>
            <select
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none text-foreground dark:bg-neutral-900"
              value={profileApprovalPolicy}
              onChange={(event) =>
                setProfileApprovalPolicy(event.target.value as any)
              }
            >
              <option
                value="untrusted"
                className="dark:bg-neutral-950 text-foreground"
              >
                untrusted (Always ask)
              </option>
              <option
                value="on-failure"
                className="dark:bg-neutral-950 text-foreground"
              >
                on-failure (Ask on error)
              </option>
              <option
                value="on-request"
                className="dark:bg-neutral-950 text-foreground"
              >
                on-request (Ask before run)
              </option>
              <option
                value="never"
                className="dark:bg-neutral-950 text-foreground"
              >
                never (No approval)
              </option>
            </select>
          </label>
          <label className="block space-y-1.5 text-xs">
            <span className="text-muted-foreground">Sandbox access</span>
            <select
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none text-foreground dark:bg-neutral-900"
              value={profileSandbox}
              onChange={(event) => setProfileSandbox(event.target.value as any)}
            >
              <option
                value="read-only"
                className="dark:bg-neutral-950 text-foreground"
              >
                read-only (Sandbox read only)
              </option>
              <option
                value="workspace-write"
                className="dark:bg-neutral-950 text-foreground"
              >
                workspace-write (Modify workspace files)
              </option>
              <option
                value="danger-full-access"
                className="dark:bg-neutral-950 text-foreground"
              >
                danger-full-access (Host access)
              </option>
            </select>
          </label>
          <label className="block space-y-1.5 text-xs col-span-2">
            <span className="text-muted-foreground flex items-center justify-between gap-2">
              Permission profile (preferred over legacy sandbox when set)
              <Button
                variant="ghost"
                size="xs"
                className="h-6 text-[10px]"
                disabled={permissionProfilesLoading || !currentThreadId}
                onClick={async () => {
                  if (!currentThreadId) return
                  setPermissionProfilesLoading(true)
                  try {
                    const profiles = await listCodexPermissionProfiles(
                      currentThreadId
                    )
                    setPermissionProfiles(profiles)
                    toast.success('Loaded permission profiles from Codex session')
                  } catch (e) {
                    setPermissionProfiles({ error: String(e) })
                    toast.error('Failed to list permission profiles')
                  } finally {
                    setPermissionProfilesLoading(false)
                  }
                }}
              >
                {permissionProfilesLoading ? 'Loading…' : 'List from session'}
              </Button>
            </span>
            <Input
              className="font-mono text-xs"
              placeholder="e.g. developer (maps to default_permissions in config.toml)"
              value={profilePermissionProfile}
              onChange={(e) => setProfilePermissionProfile(e.target.value)}
            />
            {permissionProfiles ? (
              <pre className="whitespace-pre-wrap break-words max-h-20 overflow-auto rounded border bg-background/50 p-2 font-mono text-[10px]">
                {JSON.stringify(permissionProfiles, null, 2)}
              </pre>
            ) : null}
            <div className="text-[10px] text-muted-foreground">
              Newer Codex permission profiles supersede legacy sandbox when set.
              Written to config.toml as default_permissions for sessions using this profile.
            </div>
          </label>
          <div className="grid grid-cols-2 gap-3 col-span-2">
            <label className="block space-y-1.5 text-xs">
              <span className="text-muted-foreground">
                Subagent max threads ([agents].max_threads)
              </span>
              <Input
                type="number"
                min={1}
                className="font-mono text-xs"
                placeholder="e.g. 4"
                value={profileSubagentMaxThreads ?? ''}
                onChange={(e) => {
                  const raw = e.target.value.trim()
                  setProfileSubagentMaxThreads(
                    raw ? Number.parseInt(raw, 10) : undefined
                  )
                }}
              />
            </label>
            <label className="block space-y-1.5 text-xs">
              <span className="text-muted-foreground">
                Subagent max depth ([agents].max_depth)
              </span>
              <Input
                type="number"
                min={1}
                className="font-mono text-xs"
                placeholder="e.g. 2"
                value={profileSubagentMaxDepth ?? ''}
                onChange={(e) => {
                  const raw = e.target.value.trim()
                  setProfileSubagentMaxDepth(
                    raw ? Number.parseInt(raw, 10) : undefined
                  )
                }}
              />
            </label>
            <div className="col-span-2 text-[10px] text-muted-foreground">
              Emitted to config.toml [agents] for Codex subagent parallelism limits.
            </div>
          </div>
          <label className="block space-y-1.5 text-xs col-span-2">
            <span className="text-muted-foreground">
              AGENTS.md (Codex instructions)
            </span>
            <textarea
              className="flex min-h-[80px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none text-foreground dark:bg-neutral-900 font-mono"
              placeholder="Global instructions for Codex (written to AGENTS.md in this profile's CODEX_HOME). Codex discovers and follows these automatically."
              value={profileAgentsMd}
              onChange={(e) => setProfileAgentsMd(e.target.value)}
            />
          </label>

          {/* addDirs — first-class per-profile for Codex --add-dir / extraDirectories / worktrees support */}
          <label className="block space-y-1">
            <span className="text-muted-foreground">
              Additional directories (add-dirs / extra workspace roots)
            </span>
            <textarea
              className="flex min-h-[60px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none text-foreground dark:bg-neutral-900 font-mono text-xs"
              placeholder={'/path/to/extra\n../sibling-repo\n(One absolute or relative path per line. Passed as extraDirectories to Codex thread/start for this profile.)'}
              value={profileAddDirs}
              onChange={(e) => setProfileAddDirs(e.target.value)}
            />
            <div className="text-[10px] text-muted-foreground">
              These are granted to Codex sessions using this profile (maps to --add-dir behavior and worktree access). Stored per-profile and applied automatically via the active chat/workspace scope.
            </div>
          </label>

          {/* Advanced config snippet for hooks/rules/skills/plugins + other Codex config (written into the session config.toml) */}
          <label className="block space-y-1">
            <span className="text-muted-foreground">
              Advanced config snippet (hooks, rules, skills, plugins, etc.)
            </span>
            <textarea
              className="flex min-h-[80px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none text-foreground dark:bg-neutral-900 font-mono text-xs"
              placeholder={'[hooks]\non-file-change = ["..."]\n\n[[skills]]\nname = "my-skill"\n\n# Any other valid Codex config keys/sections per config-reference and /codex/hooks /codex/skills /codex/plugins docs.'}
              value={profileAdvancedConfigSnippet}
              onChange={(e) => setProfileAdvancedConfigSnippet(e.target.value)}
            />
            <div className="text-[10px] text-muted-foreground">
              This raw TOML is appended to the generated config.toml for Codex sessions with this profile active. Use for [hooks], rules, [[skills]], [plugins], or other advanced keys (see Codex docs: config-reference, hooks, skills, plugins, rules). Automatically scoped to the profile's CODEX_HOME.
            </div>
          </label>

          {/* Codex CLI doctor + remote app-server management */}
          <div className="rounded-md border border-border/60 bg-muted/5 p-2 text-xs col-span-2 space-y-2">
            <div className="font-medium">Codex CLI & Remote App-Server</div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="xs"
                disabled={doctorLoading || !activeProfile}
                onClick={async () => {
                  if (!activeProfile) return
                  setDoctorLoading(true)
                  setDoctorResult(null)
                  try {
                    const result = await runCodexDoctor({
                      codexHome: activeProfile.codexHome,
                    })
                    const text = [result.stdout, result.stderr]
                      .filter(Boolean)
                      .join('\n')
                      .trim()
                    setDoctorResult(
                      text ||
                        `Exit code: ${result.exitCode ?? 'unknown'}`
                    )
                    if (result.exitCode === 0) {
                      toast.success('Codex doctor completed')
                    } else {
                      toast.error('Codex doctor reported issues')
                    }
                  } catch (e) {
                    setDoctorResult(String(e))
                    toast.error('Codex doctor failed')
                  } finally {
                    setDoctorLoading(false)
                  }
                }}
              >
                {doctorLoading ? 'Running doctor…' : 'Run codex doctor'}
              </Button>
              <Button
                variant="outline"
                size="xs"
                disabled={remoteLoading || !currentThreadId}
                onClick={async () => {
                  if (!currentThreadId) return
                  setRemoteLoading(true)
                  try {
                    const status = await readCodexRemoteControlStatus(
                      currentThreadId
                    )
                    setRemoteStatus(status)
                  } catch (e) {
                    setRemoteStatus({ error: String(e) })
                  } finally {
                    setRemoteLoading(false)
                  }
                }}
              >
                Remote status
              </Button>
              <Button
                variant="outline"
                size="xs"
                disabled={!currentThreadId}
                onClick={async () => {
                  if (!currentThreadId) return
                  try {
                    await enableCodexRemoteControl(currentThreadId)
                    toast.success('Remote control enabled')
                    setRemoteStatus(
                      await readCodexRemoteControlStatus(currentThreadId)
                    )
                  } catch (e) {
                    toast.error(String(e))
                  }
                }}
              >
                Enable remote
              </Button>
              <Button
                variant="outline"
                size="xs"
                disabled={!currentThreadId}
                onClick={async () => {
                  if (!currentThreadId) return
                  try {
                    await disableCodexRemoteControl(currentThreadId)
                    toast.success('Remote control disabled')
                    setRemoteStatus(
                      await readCodexRemoteControlStatus(currentThreadId)
                    )
                  } catch (e) {
                    toast.error(String(e))
                  }
                }}
              >
                Disable remote
              </Button>
              <Button
                variant="outline"
                size="xs"
                disabled={!currentThreadId}
                onClick={async () => {
                  if (!currentThreadId) return
                  try {
                    const pairing = await startCodexRemoteControlPairing(
                      currentThreadId,
                      { manualCode: true }
                    )
                    setRemoteStatus(pairing)
                    toast.success('Remote pairing started')
                  } catch (e) {
                    toast.error(String(e))
                  }
                }}
              >
                Start pairing
              </Button>
            </div>
            {doctorResult ? (
              <pre className="whitespace-pre-wrap break-words max-h-32 overflow-auto rounded border bg-background/50 p-2 font-mono text-[10px]">
                {doctorResult}
              </pre>
            ) : null}
            <div className="space-y-1 border-t border-border/40 pt-2">
              <div className="font-medium text-[11px]">Non-interactive exec / resume</div>
              <textarea
                className="flex min-h-[48px] w-full rounded-md border border-input bg-transparent px-2 py-1 font-mono text-[10px]"
                placeholder="Prompt for codex exec (non-interactive automation)"
                value={execPrompt}
                onChange={(e) => setExecPrompt(e.target.value)}
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="xs"
                  disabled={execLoading || !activeProfile || !execPrompt.trim()}
                  onClick={async () => {
                    if (!activeProfile) return
                    setExecLoading(true)
                    setExecResult(null)
                    try {
                      const addDirs = profileAddDirs
                        .split('\n')
                        .map((line) => line.trim())
                        .filter(Boolean)
                      const result = await runCodexExec({
                        prompt: execPrompt.trim(),
                        codexHome: activeProfile.codexHome,
                        addDirs,
                        sandbox: profileSandbox,
                        jsonOutput: true,
                      })
                      const text = [result.stdout, result.stderr]
                        .filter(Boolean)
                        .join('\n')
                        .trim()
                      setExecResult(
                        text || `Exit code: ${result.exitCode ?? 'unknown'}`
                      )
                      if (result.exitCode === 0) {
                        toast.success('Codex exec completed')
                      } else {
                        toast.error('Codex exec failed')
                      }
                    } catch (e) {
                      setExecResult(String(e))
                      toast.error('Codex exec failed')
                    } finally {
                      setExecLoading(false)
                    }
                  }}
                >
                  {execLoading ? 'Running exec…' : 'Run codex exec'}
                </Button>
              </div>
              {execResult ? (
                <pre className="whitespace-pre-wrap break-words max-h-24 overflow-auto rounded border bg-background/50 p-2 font-mono text-[10px]">
                  {execResult}
                </pre>
              ) : null}
              <div className="flex flex-wrap gap-2 items-center">
                <Input
                  className="h-7 text-[10px] font-mono max-w-[200px]"
                  placeholder="Session id (optional)"
                  value={resumeSessionId}
                  onChange={(e) => setResumeSessionId(e.target.value)}
                />
                <Input
                  className="h-7 text-[10px] font-mono flex-1 min-w-[120px]"
                  placeholder="Optional follow-up prompt"
                  value={resumePrompt}
                  onChange={(e) => setResumePrompt(e.target.value)}
                />
                <Button
                  variant="outline"
                  size="xs"
                  disabled={resumeLoading || !activeProfile}
                  onClick={async () => {
                    if (!activeProfile) return
                    setResumeLoading(true)
                    setResumeResult(null)
                    try {
                      const result = await runCodexResume({
                        sessionId: resumeSessionId.trim() || undefined,
                        prompt: resumePrompt.trim() || undefined,
                        last: !resumeSessionId.trim(),
                        codexHome: activeProfile.codexHome,
                      })
                      const text = [result.stdout, result.stderr]
                        .filter(Boolean)
                        .join('\n')
                        .trim()
                      setResumeResult(
                        text || `Exit code: ${result.exitCode ?? 'unknown'}`
                      )
                      if (result.exitCode === 0) {
                        toast.success('Codex resume completed')
                      } else {
                        toast.error('Codex resume reported issues')
                      }
                    } catch (e) {
                      setResumeResult(String(e))
                      toast.error('Codex resume failed')
                    } finally {
                      setResumeLoading(false)
                    }
                  }}
                >
                  {resumeLoading ? 'Resuming…' : 'Run codex resume'}
                </Button>
              </div>
              {resumeResult ? (
                <pre className="whitespace-pre-wrap break-words max-h-24 overflow-auto rounded border bg-background/50 p-2 font-mono text-[10px]">
                  {resumeResult}
                </pre>
              ) : null}
            </div>
            {remoteStatus ? (
              <pre className="whitespace-pre-wrap break-words max-h-24 overflow-auto rounded border bg-background/50 p-2 font-mono text-[10px]">
                {JSON.stringify(remoteStatus, null, 2)}
              </pre>
            ) : null}
            <div className="text-[10px] text-muted-foreground">
              Doctor uses the active profile CODEX_HOME. Remote control requires an open Codex-backed chat (app-server session).
            </div>
          </div>

          {/* Runtime app-server capability layer (skills/plugins/hooks + mcp oauth + remote + config) */}
          <div className="rounded-md border border-border/60 bg-muted/5 p-2 text-xs">
            <div className="font-medium mb-1">Runtime Capabilities (Skills / Plugins / Hooks)</div>
            <div className="text-muted-foreground">
              In addition to static declaration via the snippet above, the Codex app-server exposes live management RPCs (listSkills, installPlugin, setSkillExtraRoots, listHooks, startMcpOauthLogin, remoteControl, config read/write, etc.).
              These are now bridged as first-class high-level calls (see chat-backend exports) and surfaced in the Review tab of the agent workspace side panel for any codex-backed chat (refresh loads live state from the active session).
              Jan owns the UI/curations/approvals; Codex owns the execution and skill selection.
            </div>
            <div className="mt-1 text-[10px] italic text-muted-foreground">
              Open a chat using this profile, switch to the Review side panel tab, and use "Refresh from Codex session" to inspect/manage at runtime. Events like skills_changed stream into Codex activity.
            </div>
          </div>
          <label className="block space-y-1.5 text-xs col-span-2">
            <span className="text-muted-foreground">
              Custom Agents (JSON array for subagents)
            </span>
            <textarea
              className="flex min-h-[100px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none text-foreground dark:bg-neutral-900 font-mono text-xs"
              placeholder='[{"name":"my-explorer","description":"Specialized explorer","developer_instructions":"You are an expert at exploring codebases for security issues...","sandbox_mode":"read-only"}]'
              value={profileCustomAgentsJson}
              onChange={(e) => setProfileCustomAgentsJson(e.target.value)}
            />
            <div className="text-[10px] text-muted-foreground">
              Each will be written as agents/&lt;name&gt;.toml when using this
              profile with Codex. See Codex docs for fields (name, description,
              developer_instructions required).
            </div>
          </label>
        </div>

        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Button variant="outline" size="xs" onClick={saveProfile}>
              {editingProfileId ? 'Update profile' : 'Save profile'}
            </Button>
            <Button
              variant="ghost"
              size="xs"
              disabled={profileProbe.loading}
              onClick={() => void probeProfileEndpoint()}
            >
              {profileProbe.loading ? 'Probing' : 'Probe'}
            </Button>
            <Button
              variant="ghost"
              size="xs"
              disabled={!activeProfile}
              onClick={() => void writeProfileArtifacts()}
            >
              Write artifacts
            </Button>
          </div>
          {activeProfile && (
            <div className="truncate text-xs text-muted-foreground">
              Active: {activeProfile.name}
            </div>
          )}
        </div>

        {(profileProbe.reachable !== undefined || profileProbe.error) && (
          <div
            className={cn(
              'rounded-md border px-2 py-1.5 text-xs',
              profileProbe.reachable
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                : 'border-destructive/30 bg-destructive/10 text-destructive'
            )}
          >
            {profileProbe.reachable
              ? `Reachable${profileProbe.statusCode ? ` · HTTP ${profileProbe.statusCode}` : ''}${typeof profileProbe.modelCount === 'number' ? ` · ${profileProbe.modelCount} model${profileProbe.modelCount === 1 ? '' : 's'}` : ''}`
              : profileProbe.error || 'Endpoint not reachable'}
          </div>
        )}

        {profileList.length > 0 && (
          <div className="space-y-2">
            {profileList.map((profile) => (
              <div
                key={profile.id}
                className={cn(
                  'flex items-center gap-2 rounded-md border px-2 py-1.5 text-xs',
                  profile.id === activeProfileId
                    ? 'border-border bg-foreground/5'
                    : 'border-border/60'
                )}
              >
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  onClick={() => loadProfileIntoForm(profile.id)}
                >
                  <div className="truncate font-medium text-foreground">
                    {profile.name}
                  </div>
                  <div className="truncate text-muted-foreground">
                    {profile.model} · {profile.baseUrl}
                  </div>
                </button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  title="Remove profile"
                  onClick={() => removeProfile(profile.id)}
                >
                  <X className="size-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}

        {profilePreview && (
          <div className="rounded-md border bg-foreground/5 p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="text-xs font-medium text-foreground">
                Launch/config preview
              </div>
              <Button
                variant="ghost"
                size="xs"
                onClick={() => void copyProfilePreview()}
              >
                Copy
              </Button>
            </div>
            <pre className="overflow-x-auto text-[11px] text-muted-foreground">
              {JSON.stringify(profilePreview, null, 2)}
            </pre>
          </div>
        )}

        {profileArtifactResult && (
          <div className="rounded-md border bg-foreground/5 p-3">
            <div className="mb-2 text-xs font-medium text-foreground">
              Written artifacts
            </div>
            <div className="space-y-1 font-mono text-[11px] text-muted-foreground">
              <div className="truncate" title={profileArtifactResult.codexHome}>
                CODEX_HOME: {profileArtifactResult.codexHome}
              </div>
              <div
                className="truncate"
                title={profileArtifactResult.manifestPath}
              >
                manifest: {profileArtifactResult.manifestPath}
              </div>
              <div className="truncate" title={profileArtifactResult.envPath}>
                env: {profileArtifactResult.envPath}
              </div>
            </div>
          </div>
        )}
      </section>

      <section className="space-y-4 rounded-lg border border-border/60 bg-card p-4">
        <div>
          <h3 className="text-sm font-medium text-foreground">Sampling</h3>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Defaults for chat requests and local runtime playgrounds.
          </p>
        </div>
        <SamplerSlider
          label="Temperature"
          value={settings.temperature}
          min={0}
          max={2}
          step={0.05}
          onChange={(temperature) => setSettings({ ...settings, temperature })}
        />
        <SamplerSlider
          label="Top P"
          value={settings.topP}
          min={0}
          max={1}
          step={0.01}
          onChange={(topP) => setSettings({ ...settings, topP })}
        />
        <SamplerSlider
          label="Top K"
          value={settings.topK}
          min={0}
          max={200}
          step={1}
          onChange={(topK) => setSettings({ ...settings, topK })}
        />
        <SamplerSlider
          label="Repeat penalty"
          value={settings.repeatPenalty}
          min={1}
          max={2}
          step={0.01}
          onChange={(repeatPenalty) =>
            setSettings({ ...settings, repeatPenalty })
          }
        />
      </section>

      <section className="space-y-4 rounded-lg border border-border/60 bg-card p-4">
        <h3 className="text-sm font-medium text-foreground">Generation</h3>
        <label className="block space-y-2 text-sm">
          <span className="text-foreground">Max output tokens</span>
          <Input
            type="number"
            min={0}
            step={1}
            value={settings.maxTokens}
            onChange={(event) =>
              setSettings({
                ...settings,
                maxTokens: Number(event.target.value),
              })
            }
          />
        </label>
        <label className="block space-y-2 text-sm">
          <span className="text-foreground">Seed</span>
          <Input
            type="number"
            step={1}
            value={settings.seed}
            onChange={(event) =>
              setSettings({
                ...settings,
                seed: Number(event.target.value),
              })
            }
          />
        </label>
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-sm text-foreground">Stream</div>
            <div className="text-xs text-muted-foreground">
              Show tokens as they arrive.
            </div>
          </div>
          <Switch
            checked={settings.stream}
            onCheckedChange={(stream) => setSettings({ ...settings, stream })}
          />
        </div>
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-sm text-foreground">JSON mode</div>
            <div className="text-xs text-muted-foreground">
              Prefer structured output.
            </div>
          </div>
          <Switch
            checked={settings.jsonMode}
            onCheckedChange={(jsonMode) =>
              setSettings({ ...settings, jsonMode })
            }
          />
        </div>
      </section>

      <section className="rounded-lg border border-border/60 bg-card p-4">
        <h3 className="text-sm font-medium text-foreground">Request shape</h3>
        <pre className="mt-3 overflow-x-auto rounded-md bg-foreground/5 p-3 text-xs text-muted-foreground">
          {JSON.stringify(
            {
              temperature: settings.temperature,
              top_p: settings.topP,
              top_k: settings.topK,
              repeat_penalty: settings.repeatPenalty,
              max_tokens: settings.maxTokens,
              seed: settings.seed,
              stream: settings.stream,
              response_format: settings.jsonMode ? 'json' : 'text',
            },
            null,
            2
          )}
        </pre>
      </section>
    </div>
  )
}

export function StudioModelSettings() {
  const settings = useStudioSettings((state) => state.sampler)
  const setSettings = useStudioSettings((state) => state.setSampler)

  return <ModelSettingsSection settings={settings} setSettings={setSettings} />
}
