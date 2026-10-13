'use client'
import { usePathname } from 'next/navigation'
import Script from 'next/script'
import type { PostHog } from 'posthog-js'
import { useEffect, useRef } from 'react'

const GTM_ID = process.env.GTM_ID
const POSTHOG_KEY = process.env.POSTHOG_KEY
const POSTHOG_HOST = process.env.POSTHOG_HOST

type GtagWindow = Window & { gtag?: (...args: unknown[]) => void }

// Same GTM_ID / POSTHOG_KEY / POSTHOG_HOST as the old site. The App Router has
// no router events, so page views on client-side navigation are sent here.
// posthog-js (~360 KB) is loaded only when a key is configured.
export function Analytics() {
  const pathname = usePathname()
  const posthog = useRef<PostHog | null>(null)

  useEffect(() => {
    if (!POSTHOG_KEY || posthog.current) return
    let cancelled = false
    import('posthog-js').then(({ default: ph }) => {
      if (cancelled || posthog.current) return
      ph.init(POSTHOG_KEY, {
        api_host: POSTHOG_HOST,
        capture_pageview: false,
        persistence: 'localStorage+cookie',
      })
      posthog.current = ph
      ph.capture('$pageview')
    })
    return () => {
      cancelled = true
    }
  }, [])

  // Page views on client-side navigation only: the initial one is sent by
  // gtag-init below and by PostHog once it has loaded.
  const lastPath = useRef<string | null>(null)
  useEffect(() => {
    const previous = lastPath.current
    lastPath.current = pathname
    if (previous === null || previous === pathname) return
    const w = window as GtagWindow
    if (GTM_ID) w.gtag?.('config', GTM_ID, { page_path: pathname })
    posthog.current?.capture('$pageview')
  }, [pathname])

  if (!GTM_ID) return null
  return (
    <>
      <Script
        strategy="afterInteractive"
        src={`https://www.googletagmanager.com/gtag/js?id=${GTM_ID}`}
      />
      <Script id="gtag-init" strategy="afterInteractive">
        {`window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', '${GTM_ID}', { page_path: window.location.pathname });`}
      </Script>
    </>
  )
}
