import posthog from 'posthog-js'
import { useEffect } from 'react'

import { useServiceHub } from '@/hooks/useServiceHub'
import { useAnalytic } from '@/hooks/useAnalytic'
import {
  API_SERVER_REQUEST_EVENT,
  type ApiServerRequestEvent,
} from '@/types/analytics'

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
        .finally(() => {
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

          posthog.capture('app_opened')

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
