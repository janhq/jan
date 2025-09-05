import posthog from 'posthog-js'
import { useEffect } from 'react'

import { useServiceHub } from '@/hooks/useServiceHub'
import { useAnalytic } from '@/hooks/useAnalytic'
import { PlatformFeatures } from '@/lib/platform/const'
import { PlatformFeature } from '@/lib/platform/types'

export function AnalyticProvider() {
  const { productAnalytic } = useAnalytic()
  const serviceHub = useServiceHub()

  useEffect(() => {
    // Early exit if analytics are disabled for this platform
    if (!PlatformFeatures[PlatformFeature.ANALYTICS]) {
      return
    }
    if (!POSTHOG_KEY || !POSTHOG_HOST) {
      console.warn(
        'PostHog not initialized: Missing POSTHOG_KEY or POSTHOG_HOST environment variables'
      )
      return
    }
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
              properties[key] = null // Set each denied property to null
            }
          })

          return properties
        },
      })
      // Attempt to restore distinct Id from app global settings
      serviceHub.analytic().getAppDistinctId()
        .then((id) => {
          if (id) posthog.identify(id)
        })
        .finally(() => {
          posthog.opt_in_capturing()
          posthog.register({ app_version: VERSION })
          serviceHub.analytic().updateDistinctId(posthog.get_distinct_id())
        })
    } else {
      posthog.opt_out_capturing()
    }
  }, [productAnalytic, serviceHub])

  // This component doesn't render anything
  return null
}
