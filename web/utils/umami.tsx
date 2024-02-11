import { useEffect } from 'react'

import Script from 'next/script'

// Define the type for the umami data object
interface UmamiData {
  version: string
}

declare global {
  interface Window {
    umami:
      | {
          track: (event: string, data?: UmamiData) => void
        }
      | undefined
  }
}

const Umami = () => {
  const appVersion = VERSION
  const analyticsScriptPath = './umami_script.js'
  const analyticsId = ANALYTICS_ID

  useEffect(() => {
    if (!appVersion || !analyticsScriptPath || !analyticsId) return

    const ping = () => {
      // Check if umami is defined before ping
      if (window.umami !== null && typeof window.umami !== 'undefined') {
        window.umami.track(appVersion, {
          version: appVersion,
        })
      }
    }

    // Wait for umami to be defined before ping
    if (window.umami !== null && typeof window.umami !== 'undefined') {
      ping()
    } else {
      // Listen for umami script load event
      document.addEventListener('umami:loaded', ping)
    }

    // Cleanup function to remove event listener if the component unmounts
    return () => {
      document.removeEventListener('umami:loaded', ping)
    }
  }, [appVersion, analyticsScriptPath, analyticsId])

  return (
    <>
      {appVersion && analyticsScriptPath && analyticsId && (
        <Script
          src={analyticsScriptPath}
          data-website-id={analyticsId}
          data-cache="true"
          data-host-url="https://eu.umami.is"
          defer
          onLoad={() => document.dispatchEvent(new Event('umami:loaded'))}
        />
      )}
    </>
  )
}

export default Umami
