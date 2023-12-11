import { useEffect, useState } from 'react'

export type OS =
  | 'undetermined'
  | 'macos'
  | 'ios'
  | 'windows'
  | 'android'
  | 'linux'

function getOS(): OS {
  if (typeof window === 'undefined') {
    return 'undetermined'
  }

  const { userAgent } = window.navigator
  const macosPlatforms = /(Macintosh)|(MacIntel)|(MacPPC)|(Mac68K)/i
  const windowsPlatforms = /(Win32)|(Win64)|(Windows)|(WinCE)/i
  const iosPlatforms = /(iPhone)|(iPad)|(iPod)/i

  if (iosPlatforms.test(userAgent)) {
    return 'ios'
  }
  if (/Android/i.test(userAgent)) {
    return 'android'
  }

  if (macosPlatforms.test(userAgent)) {
    return 'macos'
  }
  if (windowsPlatforms.test(userAgent)) {
    return 'windows'
  }
  if (/Linux/i.test(userAgent)) {
    return 'linux'
  }

  return 'undetermined'
}

interface UseOsOptions {
  getValueInEffect: boolean
}

export function useOs(options: UseOsOptions = { getValueInEffect: true }): OS {
  const [value, setValue] = useState<OS>(
    options.getValueInEffect ? 'undetermined' : getOS()
  )

  useEffect(() => {
    if (options.getValueInEffect) {
      setValue(getOS)
    }
  }, [])

  return value
}
