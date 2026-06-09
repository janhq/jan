import posthog from 'posthog-js'
import { useEffect } from 'react'

import { useServiceHub } from '@/hooks/useServiceHub'
import { useAnalytic } from '@/hooks/useAnalytic'
import {
  API_SERVER_REQUEST_EVENT,
  type ApiServerRequestEvent,
} from '@/types/analytics'
import type { ServiceHub } from '@/services'
import { cpuAvxLevel, mapGpuVendor } from '@/lib/telemetry'

/** Resolve a promise but reject after `ms` so a slow IPC never blocks startup. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = setTimeout(() => reject(new Error('timeout')), ms)
    promise.then(
      (value) => {
        clearTimeout(id)
        resolve(value)
      },
      (error) => {
        clearTimeout(id)
        reject(error)
      }
    )
  })
}

/**
 * ATO-111: build the hardware / OS / backend super-properties registered once
 * per launch. PII contract: never include GPU UUID/serial or the machine name;
 * RAM/VRAM are plain MiB integers. Slow IPC calls are time-boxed so `app_opened`
 * is not delayed.
 */
async function collectHardwareSuperProps(
  serviceHub: ServiceHub
): Promise<Record<string, unknown>> {
  const props: Record<string, unknown> = {}

  // Backend ids come from extension-owned localStorage (no IPC, no side effects).
  const activeBackend = localStorage.getItem('llama_cpp_backend_type')
  if (activeBackend) props.active_backend = activeBackend
  try {
    const rec = localStorage.getItem('llama_cpp_better_backend_recommendation')
    if (rec) {
      const parsed = JSON.parse(rec) as { recommendedBackend?: string }
      if (parsed?.recommendedBackend)
        props.recommended_backend = parsed.recommendedBackend
    }
  } catch {
    // malformed cache — ignore
  }

  if (typeof IS_TAURI === 'undefined' || !IS_TAURI) return props

  try {
    const installerType = await withTimeout(
      serviceHub.app().getInstallerType(),
      1500
    )
    if (installerType) props.installer_type = installerType
  } catch {
    // best-effort — installer type unavailable
  }

  const hw = await withTimeout(
    serviceHub.hardware().getHardwareInfo(),
    3000
  ).catch(() => null)
  if (!hw) return props

  props.os = hw.os_type || 'unknown'
  props.os_build = hw.os_name || ''
  const arch = (hw.cpu?.arch || '').toLowerCase()
  props.arch = arch.includes('arm') || arch.includes('aarch') ? 'arm64' : 'x64'
  props.cpu_avx = cpuAvxLevel(hw.cpu?.extensions)
  props.system_ram_mb = hw.total_memory ?? null

  const gpus = hw.gpus || []
  const primary = gpus[0]
  props.gpu_detected = gpus.length > 0
  props.gpu_vendor = mapGpuVendor(primary?.vendor, IS_MACOS)
  props.gpu_model = primary?.name || null
  props.vram_mb = primary?.total_memory ?? null

  const nvidia = gpus.find((g) =>
    (g.vendor || '').toLowerCase().includes('nvidia')
  )
  if (nvidia) {
    props.nvidia_driver_version = nvidia.driver_version || null
    // Exact CUDA runtime string is not exposed by tauri-plugin-hardware;
    // surface compute capability as a best-effort proxy (see ATO-111).
    props.cuda_runtime_version = nvidia.nvidia_info?.compute_capability || null
  }
  const vk = gpus.find((g) => g.vulkan_info?.api_version)
  if (vk) props.vulkan_version = vk.vulkan_info.api_version

  const usage = await withTimeout(
    serviceHub.hardware().getSystemUsage(),
    1500
  ).catch(() => null)
  if (usage && primary) {
    const u =
      usage.gpus?.find((g) => g.uuid === primary.uuid) ?? usage.gpus?.[0]
    if (u)
      props.vram_free_mb = Math.max(
        0,
        (u.total_memory ?? 0) - (u.used_memory ?? 0)
      )
  }

  return props
}

/**
 * ATO-111: `device_parse_ok` reflects whether `llama-server --list-devices`
 * could be parsed (the `DeviceListParseFailed` flag). The probe spawns the
 * backend binary and can be slow, so it runs detached from `app_opened`.
 */
async function collectDeviceParseOk(
  serviceHub: ServiceHub
): Promise<boolean | undefined> {
  if (typeof IS_TAURI === 'undefined' || !IS_TAURI) return undefined
  try {
    await withTimeout(serviceHub.hardware().getLlamacppDevices(), 8000)
    return true
  } catch (error) {
    const code = (error as { code?: string } | undefined)?.code
    const message = (
      (error as { message?: string } | undefined)?.message ?? ''
    ).toLowerCase()
    if (
      code === 'DEVICE_LIST_PARSE_FAILED' ||
      code === 'DeviceListParseFailed' ||
      message.includes('available devices')
    )
      return false
    return undefined
  }
}

export function AnalyticProvider() {
  const { productAnalytic } = useAnalytic()
  const serviceHub = useServiceHub()

  useEffect(() => {
    if (!POSTHOG_KEY || !POSTHOG_HOST) {
      console.warn(
        'PostHog not initialized: Missing POSTHOG_KEY or POSTHOG_HOST environment variables'
      )
      return
    }

    let unlistenApiServer: (() => void) | undefined
    let cancelled = false

    if (productAnalytic) {
      posthog.init(POSTHOG_KEY, {
        api_host: POSTHOG_HOST,
        autocapture: false,
        capture_pageview: false,
        capture_pageleave: false,
        disable_session_recording: true,
        person_profiles: 'always',
        persistence: 'localStorage',
        opt_out_capturing_by_default: true,

        sanitize_properties: function (properties) {
          const denylist = [
            '$pathname',
            '$initial_pathname',
            '$current_url',
            '$initial_current_url',
            '$host',
            '$initial_host',
            '$initial_person_info',
          ]

          denylist.forEach((key) => {
            if (properties[key]) {
              properties[key] = null
            }
          })

          return properties
        },
      })
      serviceHub
        .analytic()
        .getAppDistinctId()
        .then((id) => {
          if (id) posthog.identify(id)
        })
        .finally(async () => {
          const osPlatform = IS_MACOS
            ? 'macos'
            : IS_WINDOWS
              ? 'windows'
              : IS_LINUX
                ? 'linux'
                : IS_IOS
                  ? 'ios'
                  : IS_ANDROID
                    ? 'android'
                    : 'unknown'

          posthog.opt_in_capturing()
          posthog.register({ app_version: VERSION, platform: osPlatform })
          serviceHub.analytic().updateDistinctId(posthog.get_distinct_id())

          // ATO-111: register hardware/OS/backend super-properties BEFORE
          // app_opened so they attach to it and every subsequent event. Bounded
          // by internal timeouts; failures degrade to fewer properties.
          try {
            const hwProps = await collectHardwareSuperProps(serviceHub)
            if (Object.keys(hwProps).length > 0) posthog.register(hwProps)
          } catch (err) {
            console.warn('Failed to collect hardware super-properties:', err)
          }

          if (cancelled) return

          posthog.capture('app_opened')

          // Detached: the device-list probe spawns the backend and can be slow,
          // so it must never delay app_opened. It attaches to later events.
          void collectDeviceParseOk(serviceHub).then((value) => {
            if (value !== undefined && !cancelled)
              posthog.register({ device_parse_ok: value })
          })

          // Forward Local API Server proxy telemetry emitted by the Rust
          // backend. Loaded dynamically so the web-app build stays usable in
          // non-Tauri environments. PostHog consent is already enforced via
          // `opt_in_capturing`; the extra `productAnalytic` guard is defensive
          // in case the provider effect reruns after toggling the setting.
          if (IS_TAURI) {
            import('@tauri-apps/api/event')
              .then(({ listen }) =>
                listen<ApiServerRequestEvent>(
                  API_SERVER_REQUEST_EVENT,
                  (evt) => {
                    if (!productAnalytic) return
                    posthog.capture('api_server_request', evt.payload)
                  }
                )
              )
              .then((unlisten) => {
                if (cancelled) {
                  unlisten()
                } else {
                  unlistenApiServer = unlisten
                }
              })
              .catch((err) => {
                console.warn(
                  'Failed to register api_server_request listener:',
                  err
                )
              })
          }
        })
    } else {
      posthog.opt_out_capturing()
    }

    return () => {
      cancelled = true
      unlistenApiServer?.()
    }
  }, [productAnalytic, serviceHub])

  return null
}
