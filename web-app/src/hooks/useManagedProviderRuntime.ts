import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'

import {
  getManagedProviderConfig,
  type ManagedProviderId,
} from '@/constants/managedProviders'
import { getServiceHub } from '@/hooks/useServiceHub'
import type {
  BinaryProbeResult,
  EndpointProbeResult,
  StudioRuntimeProcess,
} from '@/services/studio/types'

export type ManagedProviderRuntimeStatus = {
  binary?: BinaryProbeResult
  endpoint?: EndpointProbeResult
  process?: StudioRuntimeProcess
}

export function useManagedProviderRuntime(
  providerId: ManagedProviderId,
  baseUrl?: string,
  apiKey?: string
) {
  const config = getManagedProviderConfig(providerId)
  const [status, setStatus] = useState<ManagedProviderRuntimeStatus>({})
  const [loading, setLoading] = useState(true)
  const [logs, setLogs] = useState('')

  const refresh = useCallback(async () => {
    if (!config) return
    setLoading(true)
    try {
      const studio = getServiceHub().studio()
      const [binary, processes] = await Promise.all([
        studio.probeBinaryOnPath(config.binaryName),
        studio.listRuntimeProcesses(),
      ])

      let endpoint: EndpointProbeResult | undefined
      if (baseUrl) {
        endpoint = await studio.probeOpenaiEndpoint(baseUrl, apiKey || 'jan')
      }

      const process = processes.find((item) => item.runtimeId === providerId)
      setStatus({ binary, endpoint, process })
    } catch (error) {
      console.error(`Failed to refresh ${providerId} runtime`, error)
    } finally {
      setLoading(false)
    }
  }, [apiKey, baseUrl, config, providerId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const spawnRuntime = useCallback(
    async (model: string) => {
      if (!baseUrl) {
        toast.error('Configure a base URL before starting the runtime')
        return
      }
      try {
        await getServiceHub().studio().spawnRuntime(providerId, model, baseUrl)
        toast.success(`Started ${providerId}`)
        await refresh()
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Failed to start runtime'
        toast.error(message)
      }
    },
    [baseUrl, providerId, refresh]
  )

  const stopRuntime = useCallback(async () => {
    try {
      await getServiceHub().studio().stopRuntime(providerId)
      toast.success('Stopped managed runtime process')
      await refresh()
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to stop runtime'
      toast.error(message)
    }
  }, [providerId, refresh])

  const loadLogs = useCallback(async () => {
    try {
      const content = await getServiceHub().studio().readRuntimeLogs(providerId)
      setLogs(content)
      return content
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to read runtime logs'
      toast.error(message)
      return ''
    }
  }, [providerId])

  return {
    config,
    status,
    loading,
    logs,
    refresh,
    spawnRuntime,
    stopRuntime,
    loadLogs,
  }
}
