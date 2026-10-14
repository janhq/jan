'use client'
import { usePathname } from 'next/navigation'
import Script from 'next/script'
import type { PostHog } from 'posthog-js'
import { useCallback, useEffect, useRef } from 'react'

const GTM_ID = process.env.GTM_ID
const POSTHOG_KEY = process.env.POSTHOG_KEY
const POSTHOG_HOST = process.env.POSTHOG_HOST

type GtagWindow = Window & { gtag?: (...args: unknown[]) => void }
type PageView = { pathname: string; url: string; title: string }

// GTM_ID is the existing gtag measurement ID, not a GTM container ID.
// Each tracker drains its own queue when ready, preserving navigation that
// happens while its script loads. posthog-js is only loaded with a key.
export function Analytics() {
  const pathname = usePathname()
  const posthog = useRef<Pick<PostHog, 'capture'> | null>(null)
  const posthogPages = useRef<PageView[]>([])
  const gtagReady = useRef(false)
  const gtagPages = useRef<PageView[]>([])
  const lastPath = useRef<string | null>(null)

  const flushPosthog = useCallback(() => {
    if (!posthog.current) return
    for (const page of posthogPages.current.splice(0)) {
      posthog.current.capture('$pageview', {
        $current_url: page.url,
        $pathname: page.pathname,
        $title: page.title,
      })
    }
  }, [])

  const flushGtag = useCallback(() => {
    const w = window as GtagWindow
    if (!gtagReady.current || !w.gtag) return
    for (const page of gtagPages.current.splice(0)) {
      w.gtag('event', 'page_view', {
        send_to: GTM_ID,
        page_path: page.pathname,
        page_location: page.url,
        page_title: page.title,
      })
    }
  }, [])

  useEffect(() => {
    if (!POSTHOG_KEY || posthog.current) return
    let cancelled = false
    import('posthog-js').then(({ default: ph }) => {
      if (cancelled || posthog.current) return
      ph.init(POSTHOG_KEY, {
        api_host: POSTHOG_HOST,
        capture_pageview: false,
        persistence: 'localStorage+cookie',
        loaded: (client) => {
          if (cancelled) return
          posthog.current = client
          flushPosthog()
        },
      })
    })
    return () => {
      cancelled = true
    }
  }, [flushPosthog])

  // Snapshot the initial page as well as every pathname change. Neither
  // tracker's initialization captures a page implicitly.
  useEffect(() => {
    if (lastPath.current === pathname) return
    lastPath.current = pathname
    const page = {
      pathname,
      url: window.location.href,
      title: document.title,
    }
    if (POSTHOG_KEY) posthogPages.current.push(page)
    if (GTM_ID) gtagPages.current.push(page)
    flushPosthog()
    flushGtag()
  }, [pathname, flushPosthog, flushGtag])

  if (!GTM_ID) return null
  return (
    <>
      <Script
        strategy="afterInteractive"
        src={`https://www.googletagmanager.com/gtag/js?id=${GTM_ID}`}
      />
      <Script
        id="gtag-init"
        strategy="afterInteractive"
        onReady={() => {
          gtagReady.current = true
          flushGtag()
        }}
      >
        {`window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', '${GTM_ID}', { send_page_view: false });`}
      </Script>
    </>
  )
}
