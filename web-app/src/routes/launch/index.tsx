import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { openUrl } from '@tauri-apps/plugin-opener'
import { toast } from 'sonner'
import {
  IconChevronDown,
  IconExternalLink,
  IconLoader2,
  IconTerminal2,
} from '@tabler/icons-react'
import { route } from '@/constants/routes'
import {
  INTEGRATION_AGENTS,
  type IntegrationAgent,
} from '@/constants/integrations'
import HeaderPage from '@/containers/HeaderPage'
import { Card } from '@/containers/Card'
import { LocalApiServerPanel } from '@/containers/LocalApiServerPanel'
import { Button } from '@/components/ui/button'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useLocalApiServer } from '@/hooks/useLocalApiServer'
import { useAppState } from '@/hooks/useAppState'
import { useServiceHub } from '@/hooks/useServiceHub'
import { cn } from '@/lib/utils'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = createFileRoute(route.launch.index as any)({
  component: LaunchPage,
})

// Only reveal the in-button spinner once an action has been running longer
// than this; near-instant config writes finish first and never flash it.
const SPINNER_DELAY_MS = 350

function IconBox({
  children,
  bg,
}: {
  children: ReactNode
  bg?: string
}) {
  return (
    <div
      className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-md"
      style={bg ? { backgroundColor: bg } : undefined}
    >
      {children}
    </div>
  )
}

function AgentIcon({ agent }: { agent: IntegrationAgent }) {
  switch (agent.id) {
    case 'claude-code':
      return (
        <IconBox bg="#1f1e1d">
          <svg
            width="24"
            height="18"
            viewBox="0 0 99 72"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path d="M9 0H90V54H9V0Z" fill="#D77757" />
            <path d="M0 18H9V36H0V18Z" fill="#D77757" />
            <path d="M18 18H27V27H18V18Z" fill="#1f1e1d" />
            <path d="M72 18H81V27H72V18Z" fill="#1f1e1d" />
            <path d="M90 18H99V36H90V18Z" fill="#D77757" />
            <path d="M9 54H18V72H9V54Z" fill="#D77757" />
            <path d="M63 54H72V72H63V54Z" fill="#D77757" />
            <path d="M27 54H36V72H27V54Z" fill="#D77757" />
            <path d="M81 54H90V72H81V54Z" fill="#D77757" />
          </svg>
        </IconBox>
      )
    case 'codex':
      return (
        <IconBox bg="#000000">
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="#ffffff"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z" />
          </svg>
        </IconBox>
      )
    case 'opencode':
      return (
        <IconBox bg="#1a1717">
          <svg
            width="22"
            height="22"
            viewBox="0 0 300 300"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <g transform="translate(30, 0)">
              <path d="M180 240H60V120H180V240Z" fill="#4B4646" />
              <path
                d="M180 60H60V240H180V60ZM240 300H0V0H240V300Z"
                fill="#F1ECEC"
              />
            </g>
          </svg>
        </IconBox>
      )
    case 'copilot':
      return (
        <IconBox bg="#000000">
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="#ffffff"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path d="M23.922 16.997C23.061 18.492 18.063 22.02 12 22.02 5.937 22.02.939 18.492.078 16.997A.641.641 0 0 1 0 16.741v-2.869a.883.883 0 0 1 .053-.22c.372-.935 1.347-2.292 2.605-2.656.167-.429.414-1.055.644-1.517a10.098 10.098 0 0 1-.052-1.086c0-1.331.282-2.499 1.132-3.368.397-.406.89-.717 1.474-.952C7.255 2.937 9.248 1.98 11.978 1.98c2.731 0 4.767.957 6.166 2.093.584.235 1.077.546 1.474.952.85.869 1.132 2.037 1.132 3.368 0 .368-.014.733-.052 1.086.23.462.477 1.088.644 1.517 1.258.364 2.233 1.721 2.605 2.656a.841.841 0 0 1 .053.22v2.869a.641.641 0 0 1-.078.256Zm-11.75-5.992h-.344a4.359 4.359 0 0 1-.355.508c-.77.947-1.918 1.492-3.508 1.492-1.725 0-2.989-.359-3.782-1.259a2.137 2.137 0 0 1-.085-.104L4 11.746v6.585c1.435.779 4.514 2.179 8 2.179 3.486 0 6.565-1.4 8-2.179v-6.585l-.098-.104s-.033.045-.085.104c-.793.9-2.057 1.259-3.782 1.259-1.59 0-2.738-.545-3.508-1.492a4.359 4.359 0 0 1-.355-.508Zm2.328 3.25c.549 0 1 .451 1 1v2c0 .549-.451 1-1 1-.549 0-1-.451-1-1v-2c0-.549.451-1 1-1Zm-5 0c.549 0 1 .451 1 1v2c0 .549-.451 1-1 1-.549 0-1-.451-1-1v-2c0-.549.451-1 1-1Zm3.313-6.185c.136 1.057.403 1.913.878 2.497.442.544 1.134.938 2.344.938 1.573 0 2.292-.337 2.657-.751.384-.435.558-1.15.558-2.361 0-1.14-.243-1.847-.705-2.319-.477-.488-1.319-.862-2.824-1.025-1.487-.161-2.192.138-2.533.529-.269.307-.437.808-.438 1.578v.021c0 .265.021.562.063.893Zm-1.626 0c.042-.331.063-.628.063-.894v-.02c-.001-.77-.169-1.271-.438-1.578-.341-.391-1.046-.69-2.533-.529-1.505.163-2.347.537-2.824 1.025-.462.472-.705 1.179-.705 2.319 0 1.211.175 1.926.558 2.361.365.414 1.084.751 2.657.751 1.21 0 1.902-.394 2.344-.938.475-.584.742-1.44.878-2.497Z" />
          </svg>
        </IconBox>
      )
    case 'openclaw':
      return (
        <IconBox bg="#ffffff">
          <img
            src="/images/integrations/openclaw.png"
            alt={agent.name}
            className="size-full object-contain"
          />
        </IconBox>
      )
    case 'hermes':
      return (
        <IconBox bg="#ffffff">
          <img
            src="/images/integrations/hermes.png"
            alt={agent.name}
            className="size-full object-contain"
          />
        </IconBox>
      )
    default:
      return (
        <IconBox bg="#52525b">
          <span className="text-sm font-semibold text-white">
            {agent.name.charAt(0)}
          </span>
        </IconBox>
      )
  }
}

// Installs are indeterminate (npm / curl script) with no progress %, so the
// button cycles short status messages to make it clear work is ongoing.
const INSTALL_STEP_KEYS = [
  'launch:installSteps.installing',
  'launch:installSteps.downloading',
  'launch:installSteps.building',
  'launch:installSteps.settingUp',
] as const

function InstallingLabel() {
  const { t } = useTranslation()
  const [step, setStep] = useState(0)
  useEffect(() => {
    const id = setInterval(
      () => setStep((s) => (s + 1) % INSTALL_STEP_KEYS.length),
      4000
    )
    return () => clearInterval(id)
  }, [])
  // Fixed, compact width so the label + spinner fit inside the same-size
  // (Run-width) button and it never jumps as the text changes.
  // `key={step}` remounts the node on each change so the browser repaints it
  // cleanly — without it the previous frame's text was left as a stale-paint
  // rectangle next to the spinning (`animate-spin`) icon's compositing layer.
  return (
    <span
      key={step}
      className="pointer-events-none inline-block w-[68px] select-none truncate text-center text-xs leading-none"
    >
      {t(INSTALL_STEP_KEYS[step])}
    </span>
  )
}

function LaunchPage() {
  const { t } = useTranslation()
  const {
    serverHost,
    serverPort,
    setServerPort,
    apiPrefix,
    apiKey,
    trustedHosts,
    corsEnabled,
    verboseLogs,
    proxyTimeout,
  } = useLocalApiServer()
  const { serverStatus, setServerStatus } = useAppState()
  const serviceHub = useServiceHub()

  const [installed, setInstalled] = useState<Record<string, boolean>>({})
  const [busy, setBusy] = useState<Record<string, boolean>>({})
  const [spinning, setSpinning] = useState<Record<string, boolean>>({})
  const [phase, setPhase] = useState<
    Record<string, 'installing' | 'configuring' | undefined>
  >({})
  const [runningModels, setRunningModels] = useState<string[]>([])
  const [logs, setLogs] = useState<Record<string, string[]>>({})
  const [openLog, setOpenLog] = useState<Record<string, boolean>>({})

  const detect = useCallback(
    async (agent: IntegrationAgent): Promise<boolean> => {
      try {
        const ok = await invoke<boolean>('detect_agent_installed', {
          bin: agent.detectBin,
        })
        setInstalled((prev) => ({ ...prev, [agent.id]: ok }))
        return ok
      } catch {
        setInstalled((prev) => ({ ...prev, [agent.id]: false }))
        return false
      }
    },
    []
  )

  const refreshRunningModels = useCallback(async () => {
    try {
      const active = (await serviceHub.models().getActiveModels()) || []
      setRunningModels(active)
    } catch {
      setRunningModels([])
    }
  }, [serviceHub])

  useEffect(() => {
    INTEGRATION_AGENTS.forEach((agent) => detect(agent))
  }, [detect])

  useEffect(() => {
    refreshRunningModels()
  }, [refreshRunningModels, serverStatus])

  const activeModel = runningModels[0] ?? null

  const ensureServerRunning = useCallback(async () => {
    if (serverStatus === 'running') return
    try {
      const actualPort = await window.core?.api?.startServer({
        host: serverHost,
        port: serverPort,
        prefix: apiPrefix,
        apiKey,
        trustedHosts,
        isCorsEnabled: corsEnabled,
        isVerboseEnabled: verboseLogs,
        proxyTimeout,
      })
      if (actualPort && actualPort !== serverPort) setServerPort(actualPort)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (!msg.includes('already running')) throw err
    }
    setServerStatus('running')
  }, [
    serverStatus,
    serverHost,
    serverPort,
    apiPrefix,
    apiKey,
    trustedHosts,
    corsEnabled,
    verboseLogs,
    proxyTimeout,
    setServerPort,
    setServerStatus,
  ])

  // Install the agent's binary, streaming its installer log. Returns whether
  // the install succeeded. Does NOT manage the shared busy/spinner state —
  // `handleRun` owns that so install + configure read as one action.
  const installAgent = useCallback(
    async (agent: IntegrationAgent): Promise<boolean> => {
      setLogs((prev) => ({ ...prev, [agent.id]: [] }))
      setOpenLog((prev) => ({ ...prev, [agent.id]: true }))

      let unlisten: UnlistenFn | undefined
      try {
        unlisten = await listen<string>(
          `agent_install_log:${agent.id}`,
          (event) => {
            setLogs((prev) => ({
              ...prev,
              [agent.id]: [...(prev[agent.id] ?? []), event.payload],
            }))
          }
        )
        await invoke('install_agent', { agentId: agent.id })
        toast.success(t('launch:toast.installSuccess', { name: agent.name }), {
          description: t('launch:toast.installSuccessDesc', {
            name: agent.name,
          }),
        })
        await detect(agent)
        return true
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        toast.error(t('launch:toast.installFailed', { name: agent.name }), {
          description: msg,
        })
        return false
      } finally {
        unlisten?.()
      }
    },
    [detect, t]
  )

  // Write the agent's config so it points at the local server. Throws on
  // failure so the caller can surface a single error toast.
  const configureAgent = useCallback(
    async (agent: IntegrationAgent, model: string | null) => {
      if (serverStatus !== 'running') {
        toast.info(t('launch:toast.serverStarting'), {
          description: t('launch:toast.serverStartingDesc', {
            name: agent.name,
          }),
        })
        await ensureServerRunning()
      }

      // `serverHost` may be a bind-all address (0.0.0.0 / ::) which clients
      // cannot connect to; agents need a real loopback address.
      const connectHost =
        serverHost === '0.0.0.0' || (serverHost as string) === '::'
          ? '127.0.0.1'
          : serverHost
      const base = `http://${connectHost}:${serverPort}`
      const apiUrl = agent.endpointWithPrefix ? `${base}${apiPrefix}` : base
      const key = apiKey || undefined

      switch (agent.id) {
        case 'claude-code':
          await invoke('configure_claude_code', {
            apiUrl,
            model: model ?? undefined,
            apiKey: key,
          })
          break
        case 'codex':
          await invoke('configure_codex', { apiUrl, model, apiKey: key })
          break
        case 'opencode':
          await invoke('configure_opencode', { apiUrl, model, apiKey: key })
          break
        case 'copilot':
          await invoke('configure_copilot', { apiUrl, model, apiKey: key })
          break
        case 'hermes':
          await invoke('configure_hermes_agent', {
            apiUrl,
            model,
            apiKey: key,
            contextLength: 20000,
          })
          break
        case 'openclaw':
          await invoke('configure_openclaw', { apiUrl, model, apiKey: key })
          break
        default:
          throw new Error(`Unknown agent: ${agent.id}`)
      }

      toast.success(t('launch:toast.configured', { name: agent.name }), {
        description: t('launch:toast.configuredDesc', { name: agent.name }),
        duration: 8000,
      })
    },
    [serverStatus, ensureServerRunning, serverHost, serverPort, apiPrefix, apiKey, t]
  )

  // Single entry point behind the unified button: install first if the agent
  // isn't present yet, then configure it to use the running model.
  const handleRun = useCallback(
    async (agent: IntegrationAgent) => {
      const model = activeModel
      if (agent.requiresModel && !model) {
        toast.error(t('launch:noRunningModelToast', { name: agent.name }))
        return
      }

      setBusy((prev) => ({ ...prev, [agent.id]: true }))
      const spinTimer = setTimeout(
        () => setSpinning((prev) => ({ ...prev, [agent.id]: true })),
        SPINNER_DELAY_MS
      )
      try {
        let present = installed[agent.id]
        if (present === undefined) present = await detect(agent)

        if (agent.installable && !present) {
          setPhase((prev) => ({ ...prev, [agent.id]: 'installing' }))
          const ok = await installAgent(agent)
          if (!ok) return
        }

        setPhase((prev) => ({ ...prev, [agent.id]: 'configuring' }))
        await configureAgent(agent, model)

        // Config is written; open a terminal running the agent so the user can
        // start immediately. A terminal failure must not fail the whole Run.
        try {
          await invoke('open_agent_terminal', { command: agent.detectBin })
        } catch (termErr) {
          const tmsg =
            termErr instanceof Error ? termErr.message : String(termErr)
          toast.warning(t('launch:toast.terminalFailed', { name: agent.name }), {
            description: tmsg,
          })
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        toast.error(t('launch:toast.configureFailed', { name: agent.name }), {
          description: msg,
        })
      } finally {
        clearTimeout(spinTimer)
        setBusy((prev) => ({ ...prev, [agent.id]: false }))
        setSpinning((prev) => ({ ...prev, [agent.id]: false }))
        setPhase((prev) => ({ ...prev, [agent.id]: undefined }))
      }
    },
    [activeModel, installed, detect, installAgent, configureAgent, t]
  )

  const coding = INTEGRATION_AGENTS.filter((a) => a.kind === 'coding')
  const assistants = INTEGRATION_AGENTS.filter((a) => a.kind === 'assistant')

  const renderAgent = (agent: IntegrationAgent) => {
    const isInstalled = installed[agent.id]
    const isBusy = busy[agent.id]
    const isSpinning = spinning[agent.id]
    const runPhase = phase[agent.id]
    const agentLogs = logs[agent.id] ?? []

    return (
      <Card key={agent.id} className="bg-card rounded-lg">
        <div className="flex items-center gap-3">
          <AgentIcon agent={agent} />
          <h2 className="font-studio truncate text-base font-medium text-foreground">
            {agent.name}
          </h2>
          {isInstalled !== undefined && (
            <span
              className={cn(
                'shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium',
                isInstalled
                  ? 'bg-emerald-500/10 text-emerald-600'
                  : 'bg-muted text-muted-foreground'
              )}
            >
              {isInstalled ? t('launch:installed') : t('launch:notInstalled')}
            </span>
          )}

          <div className="ml-auto flex shrink-0 items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => openUrl(agent.docsUrl)}
            >
              <IconExternalLink size={14} className="text-muted-foreground" />
              {t('launch:docs')}
            </Button>
            {agent.configurable && (
              <Button
                size="sm"
                className="w-[112px] transform-gpu justify-center gap-1.5 select-none"
                onClick={() => handleRun(agent)}
                disabled={isBusy}
              >
                {runPhase === 'installing' ? (
                  <>
                    <IconLoader2
                      size={14}
                      className="pointer-events-none animate-spin"
                    />
                    <InstallingLabel />
                  </>
                ) : (
                  <>
                    {runPhase === 'configuring' && isSpinning && (
                      <IconLoader2 size={14} className="animate-spin" />
                    )}
                    {t('launch:enable')}
                  </>
                )}
              </Button>
            )}
          </div>
        </div>
        <p className="mt-2 text-sm leading-normal text-muted-foreground">
          {agent.description}
        </p>

        {agentLogs.length > 0 && (
          <div className="mt-3">
            <button
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
              onClick={() =>
                setOpenLog((prev) => ({
                  ...prev,
                  [agent.id]: !prev[agent.id],
                }))
              }
            >
              <IconTerminal2 size={14} />
              {t('launch:installLog')}
              <IconChevronDown
                size={14}
                className={cn(
                  'transition-transform',
                  openLog[agent.id] && 'rotate-180'
                )}
              />
            </button>
            {openLog[agent.id] && (
              <pre className="mt-2 max-h-48 overflow-auto rounded-md bg-secondary/40 p-2 text-[11px] leading-relaxed text-muted-foreground">
                {agentLogs.join('\n')}
              </pre>
            )}
          </div>
        )}
      </Card>
    )
  }

  return (
    <div className="flex h-svh w-full flex-col">
      <HeaderPage />
      <div className="h-[calc(100%-60px)] overflow-y-auto p-4 pt-0">
        <div className="mx-auto flex max-w-3xl flex-col gap-6">
          <section className="flex flex-col gap-3">
            <div>
              <h1 className="font-studio text-lg font-medium text-foreground">
                {t('launch:serverSection')}
              </h1>
              <p className="text-sm text-muted-foreground">
                {t('launch:serverSectionDesc')}
              </p>
            </div>
            <LocalApiServerPanel />
          </section>

          <section className="flex flex-col gap-3">
            <div>
              <h1 className="font-studio text-lg font-medium text-foreground">
                {t('launch:codingAgents')}
              </h1>
              <p className="text-sm text-muted-foreground">
                {t('launch:codingAgentsDesc')}
              </p>
            </div>
            {coding.map(renderAgent)}
          </section>

          {assistants.length > 0 && (
            <section className="flex flex-col gap-3">
              <div>
                <h1 className="font-studio text-lg font-medium text-foreground">
                  {t('launch:assistants')}
                </h1>
                <p className="text-sm text-muted-foreground">
                  {t('launch:assistantsDesc')}
                </p>
              </div>
              {assistants.map(renderAgent)}
            </section>
          )}
        </div>
      </div>
    </div>
  )
}
