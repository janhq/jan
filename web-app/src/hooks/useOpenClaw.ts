import { useState, useEffect, useCallback, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen, UnlistenFn } from '@tauri-apps/api/event'
import { toast } from 'sonner'

export type OpenClawStatus = 'not-installed' | 'installing' | 'installed' | 'running'

interface InstallProgress {
  status: 'installing' | 'completed' | 'error'
  progress: number
  message: string
}

interface GatewayReadyPayload {
  gateway_url: string
}

export function useOpenClaw(pollIntervalMs = 5000) {
  const [status, setStatus] = useState<OpenClawStatus>('not-installed')
  const [gatewayUrl, setGatewayUrl] = useState<string | undefined>()
  const [isLoading, setIsLoading] = useState(false)
  const [installProgress, setInstallProgress] = useState(0)
  const [installMessage, setInstallMessage] = useState('')
  const unlistenInstallRef = useRef<UnlistenFn | null>(null)

  const checkInstalled = useCallback(async () => {
    try {
      const path = await invoke<string | null>('check_openclaw_installed')
      if (path) {
        // If installed, check if gateway is running
        const runningStatus = await invoke<{ running: boolean; gateway_url?: string }>(
          'get_openclaw_status'
        )
        if (runningStatus.running) {
          setStatus('running')
          setGatewayUrl(runningStatus.gateway_url)
        } else {
          setStatus('installed')
          setGatewayUrl(undefined)
        }
      } else {
        setStatus('not-installed')
        setGatewayUrl(undefined)
      }
    } catch (error) {
      console.error('Failed to check OpenClaw status:', error)
      setStatus('not-installed')
    }
  }, [])

  const install = useCallback(async () => {
    setIsLoading(true)
    setInstallProgress(0)
    setInstallMessage('准备安装...')
    setStatus('installing')

    try {
      const unlisten = await listen<InstallProgress>('openclaw-install-progress', (event) => {
        const { status: s, progress, message } = event.payload
        setInstallProgress(progress)
        setInstallMessage(message)
        if (s === 'completed') {
          setStatus('installed')
        } else if (s === 'error') {
          setStatus('not-installed')
        }
      })
      unlistenInstallRef.current = unlisten

      await invoke('install_openclaw')
      toast.success('OpenClaw 安装成功')
      setStatus('installed')
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      toast.error('安装失败: ' + msg)
      setStatus('not-installed')
    } finally {
      setIsLoading(false)
      if (unlistenInstallRef.current) {
        unlistenInstallRef.current()
        unlistenInstallRef.current = null
      }
    }
  }, [])

  const launch = useCallback(async (model: string) => {
    setIsLoading(true)
    try {
      toast.info(`正在启动 OpenClaw Gateway (模型: ${model})...`)
      const result = await invoke<{ gateway_url: string }>('launch_openclaw_gateway', {
        model,
      })
      setStatus('running')
      setGatewayUrl(result.gateway_url)
      toast.success('OpenClaw Gateway 已启动')
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      toast.error('启动失败: ' + msg)
    } finally {
      setIsLoading(false)
    }
  }, [])

  const stop = useCallback(async () => {
    setIsLoading(true)
    try {
      await invoke('stop_openclaw_gateway')
      setStatus('installed')
      setGatewayUrl(undefined)
      toast.success('OpenClaw Gateway 已停止')
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      toast.error('停止失败: ' + msg)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    checkInstalled()
    const timer = setInterval(checkInstalled, pollIntervalMs)

    // Listen for gateway ready events launched from elsewhere
    let gatewayUnlisten: UnlistenFn | null = null
    listen<GatewayReadyPayload>('openclaw-gateway-ready', (event) => {
      setStatus('running')
      setGatewayUrl(event.payload.gateway_url)
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
  }, [checkInstalled, pollIntervalMs])

  return {
    status,
    gatewayUrl,
    isLoading,
    installProgress,
    installMessage,
    install,
    launch,
    stop,
    refresh: checkInstalled,
  }
}
