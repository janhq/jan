'use client'
import { usePathname } from 'next/navigation'
import Script from 'next/script'
import posthog from 'posthog-js'
import { useEffect, useRef } from 'react'

const GTM_ID = process.env.GTM_ID
const POSTHOG_KEY = process.env.POSTHOG_KEY
const POSTHOG_HOST = process.env.POSTHOG_HOST

type GtagWindow = Window & { gtag?: (...args: unknown[]) => void }

// Same GTM_ID / POSTHOG_KEY / POSTHOG_HOST as the old site. The App Router has
// no router events, so page views on client-side navigation are sent here.
export function Analytics() {
  const pathname = usePathname()
  const posthogReady = useRef(false)

  useEffect(() => {
    if (!POSTHOG_KEY || posthogReady.current) return
    posthog.init(POSTHOG_KEY, {
      api_host: POSTHOG_HOST,
      capture_pageview: false,
      persistence: 'localStorage+cookie',
    })
    posthogReady.current = true
  }, [])

  useEffect(() => {
    if (!pathname) return
    const w = window as GtagWindow
    if (GTM_ID) w.gtag?.('config', GTM_ID, { page_path: pathname })
    if (posthogReady.current) posthog.capture('$pageview')
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
