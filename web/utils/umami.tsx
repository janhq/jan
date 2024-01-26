import { useEffect } from 'react'

import Script from 'next/script'

declare global {
  interface Window {
    umami: unknown | null
  }
}

const Umami = () => {
  const appVersion = VERSION
  const analyticsHost = ANALYTICS_HOST
  const analyticsId = ANALYTICS_ID

  useEffect(() => {
    const ping = () => {
      // Check if umami is defined before ping
      if (window.umami !== null && typeof window.umami !== 'undefined') {
        window.umami.track(appVersion, {
          version: appVersion,
        })
      }
    }

    // Wait for umami to be defined before ping
    if (typeof window.umami !== 'undefined') {
      ping()
    } else {
      // Listen for umami script load event
      document.addEventListener('umami:loaded', ping)
    }

    // Cleanup function to remove event listener if the component unmounts
    return () => {
      document.removeEventListener('umami:loaded', ping)
    }
  }, [appVersion])

  return (
    <>
      <Script
        src={analyticsHost}
        data-website-id={analyticsId}
        data-cache="true"
        defer
        onLoad={() => document.dispatchEvent(new Event('umami:loaded'))}
      />
    </>
  )
}

export default Umami
