import { useCallback, useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { toast } from 'sonner'
import { openExternalUrl } from '@/lib/service'

const DEFAULT_OPENCLAW_GATEWAY_PORT = 18789

export type OpenClawStatus =
  | 'not-installed'
  | 'installing'
  | 'installed'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'degraded'
  | 'error'

export interface OpenClawRuntimeSummary {
  gatewayPort?: number
  launchMode: 'existing-config' | 'local-ollama-injected'
  selectedModel?: string
}

export interface OpenClawRuntimeConfig {
  gatewayPort?: number
  injectLocalModel: boolean
  selectedModel?: string
}

export interface OpenClawDiagnostics {
  serviceLoaded: boolean
  serviceLabel?: string
  serviceRuntimeStatus?: string
  serviceRuntimeDetail?: string
  rpcOk: boolean
  rpcError?: string
  portStatus?: string
  cliConfigExists: boolean
  daemonConfigExists: boolean
  configValid: boolean
  health: string
}

interface InstallProgress {
  status: 'installing' | 'completed' | 'error'
  progress: number
  message: string
}

interface GatewayReadyPayload {
  gateway_url: string
}

interface OpenClawBackendStatus {
  installed: boolean
  binary_path?: string
  version?: string
  gateway_url?: string
  gateway_port?: number
  service_loaded: boolean
  service_label?: string
  service_runtime_status?: string
  service_runtime_detail?: string
  rpc_ok: boolean
  rpc_error?: string
  port_status?: string
  cli_config_exists: boolean
  daemon_config_exists: boolean
  config_valid: boolean
  health: string
  message?: string
}

function parseGatewayPort(gatewayUrl?: string, fallbackPort = DEFAULT_OPENCLAW_GATEWAY_PORT) {
  if (!gatewayUrl) return fallbackPort

  try {
    const port = Number(new URL(gatewayUrl).port)
    return Number.isFinite(port) && port > 0 ? port : fallbackPort
  } catch {
    return fallbackPort
  }
}

function toRuntimeSummary(config: OpenClawRuntimeConfig): OpenClawRuntimeSummary {
  return {
    gatewayPort: config.gatewayPort ?? DEFAULT_OPENCLAW_GATEWAY_PORT,
    launchMode: config.injectLocalModel ? 'local-ollama-injected' : 'existing-config',
    selectedModel: config.injectLocalModel ? config.selectedModel : undefined,
  }
}

function toUiStatus(status: OpenClawBackendStatus): OpenClawStatus {
  if (!status.installed) return 'not-installed'
  if (status.health === 'running') return 'running'
  if (status.health === 'degraded') return 'degraded'
  if (status.health === 'error') return 'error'
  return 'installed'
}

function toDiagnostics(status: OpenClawBackendStatus): OpenClawDiagnostics {
  return {
    serviceLoaded: status.service_loaded,
    serviceLabel: status.service_label,
    serviceRuntimeStatus: status.service_runtime_status,
    serviceRuntimeDetail: status.service_runtime_detail,
    rpcOk: status.rpc_ok,
    rpcError: status.rpc_error,
    portStatus: status.port_status,
    cliConfigExists: status.cli_config_exists,
    daemonConfigExists: status.daemon_config_exists,
    configValid: status.config_valid,
    health: status.health,
  }
}

export function useOpenClaw(pollIntervalMs = 5000) {
  const [status, setStatus] = useState<OpenClawStatus>('not-installed')
  const [gatewayUrl, setGatewayUrl] = useState<string | undefined>()
  const [version, setVersion] = useState<string | undefined>()
  const [isLoading, setIsLoading] = useState(false)
  const [installProgress, setInstallProgress] = useState(0)
  const [installMessage, setInstallMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState<string | undefined>()
  const [runtimeSummary, setRuntimeSummary] = useState<OpenClawRuntimeSummary>({
    gatewayPort: DEFAULT_OPENCLAW_GATEWAY_PORT,
    launchMode: 'existing-config',
    selectedModel: undefined,
  })
  const [diagnostics, setDiagnostics] = useState<OpenClawDiagnostics>({
    serviceLoaded: false,
    serviceLabel: undefined,
    serviceRuntimeStatus: undefined,
    serviceRuntimeDetail: undefined,
    rpcOk: false,
    rpcError: undefined,
    portStatus: undefined,
    cliConfigExists: false,
    daemonConfigExists: false,
    configValid: true,
    health: 'not-installed',
  })
  const unlistenInstallRef = useRef<UnlistenFn | null>(null)

  const refresh = useCallback(async () => {
    try {
      const nextStatus = await invoke<OpenClawBackendStatus>('get_openclaw_status')
      setVersion(nextStatus.version)
      setStatus((current) => {
        if (current === 'installing') {
          return current
        }
        const next = toUiStatus(nextStatus)
        // Allow transition out of starting/stopping when the backend reflects
        // the actual outcome (declarative reconciliation).
        if (current === 'starting' && next !== 'installed') {
          return next
        }
        if (
          current === 'stopping' &&
          next !== 'running' &&
          next !== 'degraded'
        ) {
          return next
        }
        return current
      })
      setGatewayUrl(nextStatus.gateway_url)
      setDiagnostics(toDiagnostics(nextStatus))
      setRuntimeSummary((current) => ({
        ...current,
        gatewayPort:
          nextStatus.gateway_port ??
          parseGatewayPort(nextStatus.gateway_url, current.gatewayPort ?? DEFAULT_OPENCLAW_GATEWAY_PORT),
      }))
      setErrorMessage(nextStatus.message)
    } catch (error) {
      console.error('Failed to check OpenClaw status:', error)
      const message = error instanceof Error ? error.message : String(error)
      setErrorMessage(message)
      setStatus('error')
    }
  }, [])

  const install = useCallback(async () => {
    setIsLoading(true)
    setInstallProgress(0)
    setInstallMessage('准备安装 OpenClaw...')
    setErrorMessage(undefined)
    setStatus('installing')

    try {
      const unlisten = await listen<InstallProgress>('openclaw-install-progress', (event) => {
        const { status: nextStatus, progress, message } = event.payload
        setInstallProgress(progress)
        setInstallMessage(message)
        if (nextStatus === 'completed') {
          setStatus('installed')
        } else if (nextStatus === 'error') {
          setStatus('error')
        }
      })
      unlistenInstallRef.current = unlisten

      await invoke('install_openclaw')
      toast.success('OpenClaw 安装成功')
      await refresh()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      toast.error(`安装失败: ${message}`)
      setErrorMessage(message)
      setStatus('error')
    } finally {
      setIsLoading(false)
      if (unlistenInstallRef.current) {
        unlistenInstallRef.current()
        unlistenInstallRef.current = null
      }
    }
  }, [refresh])

  const launch = useCallback(
    async (model?: string) => {
      setIsLoading(true)
      setErrorMessage(undefined)
      setStatus('starting')
      try {
        toast.info(
          model
            ? `已发送启动请求，将注入本地模型 ${model}`
            : '已发送启动请求，将按当前配置启动 Gateway'
        )
        const result = await invoke<{ gateway_url: string }>('launch_openclaw_gateway', {
          model: model ?? null,
        })
        setGatewayUrl(result.gateway_url)
        setRuntimeSummary({
          gatewayPort: parseGatewayPort(result.gateway_url),
          launchMode: model ? 'local-ollama-injected' : 'existing-config',
          selectedModel: model,
        })
        toast.success('启动命令已发送，正在等待 Gateway 就绪...')
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        setErrorMessage(message)
        setStatus('error')
        toast.error(`启动失败: ${message}`)
      } finally {
        setIsLoading(false)
      }
    },
    []
  )

  const stop = useCallback(async () => {
    setIsLoading(true)
    setErrorMessage(undefined)
    setStatus('stopping')
    try {
      await invoke('stop_openclaw_gateway')
      setGatewayUrl(undefined)
      toast.success('停止命令已发送')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setErrorMessage(message)
      setStatus('error')
      toast.error(`停止失败: ${message}`)
    } finally {
      setIsLoading(false)
    }
  }, [])

  const saveConfig = useCallback((config: OpenClawRuntimeConfig) => {
    setRuntimeSummary(toRuntimeSummary(config))
    toast.success('已更新当前运行面板配置')
  }, [])

  const restart = useCallback(
    async (config?: OpenClawRuntimeConfig) => {
      const nextConfig = config ? toRuntimeSummary(config) : runtimeSummary

      if (config) {
        setRuntimeSummary(nextConfig)
      }

      await launch(
        nextConfig.launchMode === 'local-ollama-injected' ? nextConfig.selectedModel : undefined
      )
    },
    [launch, runtimeSummary]
  )

  const openDashboard = useCallback(() => {
    const port = runtimeSummary.gatewayPort ?? DEFAULT_OPENCLAW_GATEWAY_PORT
    openExternalUrl(gatewayUrl ?? `http://127.0.0.1:${port}/`)
  }, [gatewayUrl, runtimeSummary.gatewayPort])

  useEffect(() => {
    void refresh()
    const timer = setInterval(() => {
      void refresh()
    }, pollIntervalMs)

    let gatewayUnlisten: UnlistenFn | null = null
    listen<GatewayReadyPayload>('openclaw-gateway-ready', (event) => {
      const nextGatewayUrl = event.payload.gateway_url
      setGatewayUrl(nextGatewayUrl)
      setRuntimeSummary((current) => ({
        ...current,
        gatewayPort: parseGatewayPort(nextGatewayUrl, current.gatewayPort ?? DEFAULT_OPENCLAW_GATEWAY_PORT),
      }))
      void refresh()
    }).then((unsub) => {
      gatewayUnlisten = unsub
    })

    return () => {
      clearInterval(timer)
      if (unlistenInstallRef.current) {
        unlistenInstallRef.current()
      }
      if (gatewayUnlisten) {
        gatewayUnlisten()
      }
    }
  }, [pollIntervalMs, refresh])

  return {
    status,
    gatewayUrl,
    version,
    isLoading,
    installProgress,
    installMessage,
    errorMessage,
    runtimeSummary,
    diagnostics,
    install,
    launch,
    stop,
    restart,
    saveConfig,
    openDashboard,
    refresh,
  }
}
