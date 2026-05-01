import { useEffect, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useShallow } from 'zustand/react/shallow'

import { useAppState } from '@/hooks/useAppState'
import { useLocalApiServer } from '@/hooks/useLocalApiServer'

type SystemUsage = {
  cpu: number
  used_memory: number
  total_memory: number
}

type MlxSession = {
  pid: number
  port: number
  model_id: string
  model_path: string
  is_embedding: boolean
  api_key: string
}

type TrayStatusPayload = {
  server_running: boolean
  server_url: string
  model_label: string
  ram_used_mb: number
  ram_total_mb: number
  ram_percent: number
}

const TRAY_REFRESH_MS = 5000

/**
 * Push live status into the macOS menu-bar tray every 5 s.
 *
 * The backing Rust command ({@link ../../../src-tauri/src/core/tray_status.rs `update_tray_status`})
 * is a no-op when the tray was never installed (non-macOS builds without the
 * `ENABLE_SYSTEM_TRAY_ICON` env gate), so this hook is safe to mount unconditionally
 * inside Tauri — but we still short-circuit on web and non-macOS to avoid
 * unnecessary IPC chatter.
 */
export function useTrayStatusSync(): void {
  const { serverStatus, activeModels } = useAppState(
    useShallow((state) => ({
      serverStatus: state.serverStatus,
      activeModels: state.activeModels,
    }))
  )
  const { serverPort, apiPrefix } = useLocalApiServer(
    useShallow((state) => ({
      serverPort: state.serverPort,
      apiPrefix: state.apiPrefix,
    }))
  )

  // Ref so the interval callback always observes the latest values without
  // restarting the timer on every dependency change.
  const latest = useRef({ serverStatus, activeModels, serverPort, apiPrefix })
  latest.current = { serverStatus, activeModels, serverPort, apiPrefix }

  useEffect(() => {
    if (!IS_TAURI || !IS_MACOS) return

    let cancelled = false

    const push = async () => {
      if (cancelled) return
      try {
        const current = latest.current
        const [usage, sessions] = await Promise.all([
          invoke<SystemUsage>('plugin:hardware|get_system_usage').catch(
            () => null
          ),
          invoke<MlxSession[]>('plugin:mlx|get_mlx_all_sessions').catch(
            () => [] as MlxSession[]
          ),
        ])

        // Prefer an active MLX session (authoritative: a running inference process),
        // fall back to `activeModels` which also tracks non-MLX engines.
        const modelLabel = (() => {
          const nonEmbedding = sessions.filter((s) => !s.is_embedding)
          if (nonEmbedding.length === 1) return nonEmbedding[0].model_id
          if (nonEmbedding.length > 1)
            return `${nonEmbedding.length} models loaded`
          if (current.activeModels.length === 1) return current.activeModels[0]
          if (current.activeModels.length > 1)
            return `${current.activeModels.length} models loaded`
          return ''
        })()

        const ramUsed = usage?.used_memory ?? 0
        const ramTotal = usage?.total_memory ?? 0
        const ramPercent =
          ramTotal > 0 ? Math.round((ramUsed / ramTotal) * 100) : 0

        const payload: TrayStatusPayload = {
          server_running: current.serverStatus === 'running',
          server_url: `http://127.0.0.1:${current.serverPort}${current.apiPrefix}`,
          model_label: modelLabel,
          ram_used_mb: ramUsed,
          ram_total_mb: ramTotal,
          ram_percent: ramPercent,
        }

        await invoke('update_tray_status', { payload })
      } catch (err) {
        // Tray is optional UI; never surface errors to the user.
        if (IS_DEV) console.debug('[tray] update failed', err)
      }
    }

    push()
    const id = setInterval(push, TRAY_REFRESH_MS)
    return () => {
      cancelled = true
      clearInterval(id)
    }
    // Re-run whenever any of the status inputs change so the tray reflects
    // transitions (server start/stop, model switch) without waiting up to 5 s.
  }, [serverStatus, activeModels, serverPort, apiPrefix])

  // Listen for "Stop Server" / "Start Server" clicks dispatched from the
  // macOS tray menu. Centralising the dispatch here (instead of calling the
  // proxy directly from Rust) keeps `serverStatus` in the React store in
  // sync with the actual server state without having to push state changes
  // back from Rust, and reuses the same `startServer` / `stopServer` service
  // calls the Local API Server settings page already uses.
  //
  // Note: the start path here mirrors `local-api-server.tsx` minus the
  // `ensureModelForServer(...)` step. Auto-loading a default model from a
  // tray-only context would surface UI (toasts, error dialogs) that the user
  // can't see without opening the app first; the assumption is that anyone
  // toggling the server from the tray has already configured a model. If
  // start fails because no model is loaded the frontend will surface the
  // error the next time the user opens the app.
  useEffect(() => {
    if (!IS_TAURI || !IS_MACOS) return
    const unlisteners: Array<() => void> = []
    let cancelled = false
    const register = (
      promise: Promise<() => void>
    ): void => {
      promise.then((fn) => {
        if (cancelled) fn()
        else unlisteners.push(fn)
      })
    }

    register(
      listen<unknown>('tray-stop-server', () => {
        const { setServerStatus } = useAppState.getState()
        setServerStatus('pending')
        window.core?.api
          ?.stopServer()
          .then(() => setServerStatus('stopped'))
          .catch((error: unknown) => {
            console.error('[tray] stop server failed', error)
            // Reset to stopped so the tray button doesn't get stuck in a
            // permanently-pending state if teardown errored partway through.
            setServerStatus('stopped')
          })
      })
    )

    register(
      listen<unknown>('tray-start-server', () => {
        const { setServerStatus } = useAppState.getState()
        const cfg = useLocalApiServer.getState()
        setServerStatus('pending')
        window.core?.api
          ?.startServer({
            host: cfg.serverHost,
            port: cfg.serverPort,
            prefix: cfg.apiPrefix,
            apiKey: cfg.apiKey,
            trustedHosts: cfg.trustedHosts,
            isCorsEnabled: cfg.corsEnabled,
            isVerboseEnabled: cfg.verboseLogs,
            proxyTimeout: cfg.proxyTimeout,
          })
          .then((actualPort: number) => {
            // Mobile uses port 0 (auto-assign) so persist whatever port the
            // proxy actually bound to — same handling as the settings page.
            if (actualPort && actualPort !== cfg.serverPort) {
              useLocalApiServer.getState().setServerPort(actualPort)
            }
            setServerStatus('running')
          })
          .catch((error: unknown) => {
            console.error('[tray] start server failed', error)
            setServerStatus('stopped')
          })
      })
    )

    return () => {
      cancelled = true
      unlisteners.forEach((fn) => fn())
    }
  }, [])
}
