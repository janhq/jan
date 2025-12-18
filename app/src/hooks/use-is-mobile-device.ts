/* eslint-disable @typescript-eslint/no-explicit-any */
import * as React from 'react'

export function useIsMobileDevice() {
  const [isMobileDevice, setIsMobileDevice] = React.useState<boolean>(false)

  React.useEffect(() => {
    const checkMobileDevice = () => {
      const userAgent =
        navigator.userAgent || navigator.vendor || (window as any).opera

      // Check for mobile devices in user agent
      const mobileRegex =
        /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i
      return mobileRegex.test(userAgent.toLowerCase())
    }

    setIsMobileDevice(checkMobileDevice())
  }, [])

  return isMobileDevice
}
