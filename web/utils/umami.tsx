import Script from 'next/script'
import { useEffect } from 'react'

// Declare umami as a global object to avoid linting errors
declare global {
  interface Window {
    umami: {
      track: (eventName: string, data: Record<string, any>) => void
    }
  }
}

const Umami = () => {
  const appVersion = VERSION

  useEffect(() => {
    const ping = () => {
      // Now TypeScript should recognize umami as a global object
      umami.track(appVersion, {
        version: appVersion,
      })
    }

    ping() // Call the ping function
  }, [appVersion])

  return (
    <>
      <Script
        src="https://us.umami.is/script.js"
        data-website-id="0d6d8b40-a7e8-4f1c-9d81-a28cfcbc28f4"
        data-cache="true"
        defer
        onLoad={() => document.dispatchEvent(new Event('umami:loaded'))}
      />
    </>
  )
}

export default Umami